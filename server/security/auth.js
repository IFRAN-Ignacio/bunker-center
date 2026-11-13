'use strict';
/**
 * Sesiones, CSRF y control de acceso.
 *
 * - La sesión es un token aleatorio de 256 bits en una cookie httpOnly (JS no la puede leer → mitiga robo por XSS).
 * - En la base se guarda solo el hash SHA-256 del token: si alguien roba la base, no puede usar las sesiones.
 * - SameSite=Lax + token CSRF (double-submit) + chequeo de Origin → protección contra CSRF.
 * - El rol se lee SIEMPRE de la base en cada petición; el front nunca decide quién es admin.
 */
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const { httpError } = require('../lib/util');

const SID_COOKIE = (config.cookieSecure ? '__Host-' : '') + config.siteId + '_sid';
const CSRF_COOKIE = (config.cookieSecure ? '__Host-' : '') + config.siteId + '_csrf';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

function safeEqual(a, b) {
    const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const baseCookie = () => ({ httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/' });

/* =========================================================
   SESIONES
   ========================================================= */
const qSession = db.prepare(`
    SELECT s.token_hash, s.user_id, s.admin_verified, s.admin_code_attempts, s.expires_at, s.last_seen,
           u.id, u.name, u.lastname, u.email, u.phone, u.role, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`);
const qTouch = db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?');
const qDelete = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const qInsert = db.prepare(`INSERT INTO sessions (token_hash, user_id, admin_verified, created_at, last_seen, expires_at, ip, user_agent)
                            VALUES (?, ?, 0, ?, ?, ?, ?, ?)`);

function createSession(req, res, user) {
    // Si ya había una sesión en este navegador, se destruye (evita "session fixation").
    destroySession(req, res);
    const token = randomToken();
    const now = Date.now();
    const ttl = user.role === 'admin' ? config.session.adminTtlMs : config.session.userTtlMs;
    qInsert.run(sha256(token), user.id, now, now, now + ttl, req.ip || null, String(req.get('user-agent') || '').slice(0, 200));
    res.cookie(SID_COOKIE, token, { ...baseCookie(), maxAge: ttl });
    // Nuevo token CSRF al cambiar de identidad.
    issueCsrf(res);
    return token;
}

function destroySession(req, res) {
    const token = req.cookies?.[SID_COOKIE];
    if (token) qDelete.run(sha256(token));
    res.clearCookie(SID_COOKIE, baseCookie());
}

function destroyUserSessions(userId, exceptHash = null) {
    if (exceptHash) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, exceptHash);
    else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Middleware: carga la sesión (si existe) en req.user / req.sess. */
function loadSession(req, res, next) {
    req.user = null;
    req.sess = null;
    const token = req.cookies?.[SID_COOKIE];
    if (!token || typeof token !== 'string' || token.length > 100) return next();

    const hash = sha256(token);
    const row = qSession.get(hash);
    const now = Date.now();

    if (!row || row.expires_at < now || now - row.last_seen > config.session.idleMs || !row.active) {
        if (row) qDelete.run(hash);
        res.clearCookie(SID_COOKIE, baseCookie());
        return next();
    }
    if (now - row.last_seen > 60_000) qTouch.run(now, hash);

    req.sess = { hash, adminVerified: !!row.admin_verified, adminCodeAttempts: row.admin_code_attempts };
    req.user = { id: row.id, name: row.name, lastname: row.lastname, email: row.email, phone: row.phone, role: row.role };
    next();
}

/* =========================================================
   CSRF — double submit cookie + verificación de Origin
   ========================================================= */
function issueCsrf(res) {
    const t = randomToken();
    // Esta cookie NO es httpOnly a propósito: el front la necesita para mandarla en el header.
    res.cookie(CSRF_COOKIE, t, { httpOnly: false, secure: config.cookieSecure, sameSite: 'strict', path: '/' });
    res.locals.csrfToken = t;
    if (!res.headersSent) res.set('X-CSRF-Token', t);
    return t;
}

function ensureCsrfCookie(req, res, next) {
    const existing = req.cookies?.[CSRF_COOKIE];
    res.locals.csrfToken = (typeof existing === 'string' && existing.length >= 32 && existing.length <= 64)
        ? existing : issueCsrf(res);
    // El front toma el token de esta cabecera: así, aunque la página haga varias consultas a la vez
    // en la primera visita, siempre usa el mismo token que quedó en la cookie (sin reintentos).
    // Otro sitio no puede leerla: el navegador bloquea las respuestas de otro origen (política same-origin).
    res.set('X-CSRF-Token', res.locals.csrfToken);
    next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function verifyCsrf(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    // 1) Origin: si el navegador lo manda, tiene que ser nuestro propio sitio.
    const origin = req.get('origin');
    if (origin) {
        const self = `${req.protocol}://${req.get('host')}`;
        if (origin !== self && !config.allowedOrigins.includes(origin)) {
            return next(httpError(403, 'Origen no permitido.'));
        }
    }
    // 2) Token: el header tiene que coincidir con la cookie.
    const cookie = req.cookies?.[CSRF_COOKIE];
    const header = req.get('x-csrf-token');
    if (!cookie || !header || !safeEqual(cookie, header)) {
        return next(httpError(403, 'Token de seguridad inválido. Recargá la página e intentá de nuevo.'));
    }
    next();
}

/* =========================================================
   CONTROL DE ACCESO
   ========================================================= */
function requireUser(req, res, next) {
    if (!req.user) return next(httpError(401, 'Tenés que iniciar sesión.'));
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user) return next(httpError(401, 'Tenés que iniciar sesión.'));
    // 404 en vez de 403 para no confirmar que existe un panel.
    if (req.user.role !== 'admin') return next(httpError(404, 'No encontrado.'));
    if (!req.sess.adminVerified) return next(httpError(401, 'Falta verificar el código de administrador.', { needsAdminCode: true }));
    next();
}

/** Solo profes. A cualquier otro rol se le responde 404, igual que con el panel admin. */
function requireTeacher(req, res, next) {
    if (!req.user) return next(httpError(401, 'Tenés que iniciar sesión.'));
    if (req.user.role !== 'profe') return next(httpError(404, 'No encontrado.'));
    next();
}

/** Solo socios: los profes y el admin no reservan ni compran planes con su cuenta de trabajo. */
function requireMember(req, res, next) {
    if (!req.user) return next(httpError(401, 'Tenés que iniciar sesión.'));
    if (req.user.role === 'profe') return next(httpError(403, 'Las cuentas de profe no reservan clases ni compran planes.'));
    next();
}

function cleanupSessions() {
    db.prepare('DELETE FROM sessions WHERE expires_at < ? OR last_seen < ?')
        .run(Date.now(), Date.now() - config.session.idleMs);
}

module.exports = {
    SID_COOKIE, CSRF_COOKIE, sha256,
    createSession, destroySession, destroyUserSessions, loadSession,
    ensureCsrfCookie, verifyCsrf, issueCsrf, requireUser, requireAdmin, requireTeacher, requireMember, cleanupSessions,
};
