'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const ah = require('../lib/ah');
const { parse, v, z, httpError, audit } = require('../lib/util');
const pw = require('../security/passwords');
const {
    createSession, destroySession, destroyUserSessions, requireUser, issueCsrf,
} = require('../security/auth');

const router = express.Router();

// Límite por IP para frenar fuerza bruta (además del bloqueo por cuenta).
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Demasiados intentos desde tu conexión. Esperá unos minutos.' },
});

const GENERIC_LOGIN_ERROR = 'Correo o contraseña incorrectos.';

const publicUser = (u) => u && ({
    id: u.id, name: u.name, lastname: u.lastname, email: u.email, phone: u.phone || '', role: u.role,
});

/* ---------- ¿Quién soy? (y token CSRF) ---------- */
router.get('/me', (req, res) => {
    res.json({
        user: publicUser(req.user),
        adminVerified: !!req.sess?.adminVerified,
        csrfToken: res.locals.csrfToken,
    });
});

/* ---------- Registro ---------- */
const registerSchema = z.object({
    name: v.text(2, 40, 'El nombre'),
    lastname: v.text(2, 40, 'El apellido'),
    email: v.email,
    phone: v.phone,
    password: v.password,
});

router.post('/register', authLimiter, ah(async (req, res) => {
    const data = parse(registerSchema, req.body);
    if (!/^[\p{L}' .-]+$/u.test(data.name) || !/^[\p{L}' .-]+$/u.test(data.lastname)) {
        throw httpError(400, 'Nombre y apellido solo pueden tener letras.');
    }
    const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(data.email);
    if (exists) throw httpError(409, 'Ese correo ya está registrado.', { field: 'email' });

    const hash = await pw.hash(data.password);
    const info = db.prepare(`INSERT INTO users (name, lastname, email, phone, password_hash, role, created_at)
                             VALUES (?, ?, ?, ?, ?, 'user', ?)`)
        .run(data.name, data.lastname, data.email, data.phone || null, hash, Date.now());

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    createSession(req, res, user);
    req.user = user;
    audit(req, 'auth.register', data.email);
    res.status(201).json({ user: publicUser(user), csrfToken: res.locals.csrfToken });
}));

/* ---------- Login ---------- */
const loginSchema = z.object({
    email: z.string().trim().toLowerCase().max(120),
    password: z.string().min(1, 'Ingresá tu contraseña.').max(200),
});

router.post('/login', authLimiter, ah(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const now = Date.now();

    if (!user) {
        await pw.verify(password, pw.DUMMY_HASH); // mismo tiempo de respuesta exista o no
        audit(req, 'auth.login_fail', `email inexistente: ${email}`);
        throw httpError(401, GENERIC_LOGIN_ERROR);
    }
    if (user.locked_until && user.locked_until > now) {
        await pw.verify(password, pw.DUMMY_HASH);
        audit(req, 'auth.login_locked', email, user.id);
        throw httpError(429, 'Demasiados intentos fallidos. Probá de nuevo en unos minutos.');
    }

    const ok = await pw.verify(password, user.password_hash);
    if (!ok) {
        const fails = user.failed_logins + 1;
        const lock = fails >= config.security.maxFailedLogins ? now + config.security.lockMinutes * 60_000 : null;
        db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
            .run(lock ? 0 : fails, lock, user.id);
        audit(req, 'auth.login_fail', lock ? 'cuenta bloqueada temporalmente' : `intento ${fails}`, user.id);
        throw httpError(401, GENERIC_LOGIN_ERROR);
    }
    if (!user.active) {
        audit(req, 'auth.login_inactive', email, user.id);
        throw httpError(403, 'Tu cuenta está desactivada. Comunicate con el gimnasio.');
    }

    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);
    createSession(req, res, user);
    req.user = user;
    audit(req, 'auth.login', user.role === 'admin' ? 'admin (falta código)' : null);

    res.json({
        user: publicUser(user),
        needsAdminCode: user.role === 'admin',
        csrfToken: res.locals.csrfToken,
    });
}));

/* ---------- Segundo factor del admin ---------- */
const codeSchema = z.object({ code: z.string().regex(/^\d{9}$/, 'El código tiene 9 dígitos.') });

router.post('/admin-code', authLimiter, requireUser, ah(async (req, res) => {
    if (req.user.role !== 'admin') throw httpError(404, 'No encontrado.');
    const { code } = parse(codeSchema, req.body);
    const row = db.prepare('SELECT admin_code_hash FROM users WHERE id = ?').get(req.user.id);

    const ok = row?.admin_code_hash ? await pw.verify(code, row.admin_code_hash) : false;
    if (!ok) {
        const attempts = req.sess.adminCodeAttempts + 1;
        audit(req, 'auth.admin_code_fail', `intento ${attempts}`);
        if (attempts >= config.security.maxAdminCodeAttempts) {
            destroySession(req, res);
            throw httpError(401, 'Demasiados intentos. Iniciá sesión de nuevo.', { restart: true });
        }
        db.prepare('UPDATE sessions SET admin_code_attempts = ? WHERE token_hash = ?').run(attempts, req.sess.hash);
        throw httpError(401, 'Código incorrecto.');
    }
    db.prepare('UPDATE sessions SET admin_verified = 1, admin_code_attempts = 0 WHERE token_hash = ?').run(req.sess.hash);
    audit(req, 'auth.admin_verified');
    res.json({ ok: true });
}));

/* ---------- Logout ---------- */
router.post('/logout', (req, res) => {
    if (req.user) audit(req, 'auth.logout');
    destroySession(req, res);
    issueCsrf(res);
    res.json({ ok: true, csrfToken: res.locals.csrfToken });
});

router.post('/logout-all', requireUser, (req, res) => {
    destroyUserSessions(req.user.id);
    audit(req, 'auth.logout_all');
    destroySession(req, res);
    res.json({ ok: true });
});

/* ---------- Cambiar contraseña ---------- */
const changeSchema = z.object({
    current: z.string().min(1, 'Ingresá tu contraseña actual.').max(200),
    password: v.password,
});

router.post('/change-password', authLimiter, requireUser, ah(async (req, res) => {
    const { current, password } = parse(changeSchema, req.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await pw.verify(current, row.password_hash))) {
        audit(req, 'auth.change_password_fail');
        throw httpError(400, 'La contraseña actual no es correcta.', { field: 'current' });
    }
    if (current === password) throw httpError(400, 'La nueva contraseña tiene que ser distinta.', { field: 'password' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await pw.hash(password), req.user.id);
    // Se cierran las demás sesiones abiertas (por si alguien más tenía acceso).
    destroyUserSessions(req.user.id, req.sess.hash);
    audit(req, 'auth.change_password');
    res.json({ ok: true });
}));

module.exports = router;
module.exports.publicUser = publicUser;
