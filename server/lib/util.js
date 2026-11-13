'use strict';
const { z } = require('zod');
const config = require('../config');
const db = require('../db');

/* =========================================================
   ERRORES
   ========================================================= */
class HttpError extends Error {
    constructor(status, message, extra) {
        super(message);
        this.status = status;
        this.extra = extra;
        this.expose = true;
    }
}
const httpError = (status, message, extra) => new HttpError(status, message, extra);
const notFound = (what = 'Recurso') => httpError(404, `${what} no encontrado.`);

/* =========================================================
   VALIDACIÓN (zod)
   Todo dato que llega del cliente se valida acá antes de tocar la base.
   ========================================================= */
function parse(schema, data) {
    const r = schema.safeParse(data);
    if (!r.success) {
        const first = r.error.issues[0];
        const field = first.path.join('.');
        throw httpError(400, first.message || 'Datos inválidos.', { field });
    }
    return r.data;
}

// Texto "limpio": sin caracteres de control, recortado y con largo acotado.
const cleanText = (min, max, label = 'El campo') =>
    z.string({ required_error: `${label} es obligatorio.`, invalid_type_error: `${label} es inválido.` })
        .transform(s => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
        .pipe(z.string()
            .min(min, min <= 1 ? `${label} es obligatorio.` : `${label} debe tener al menos ${min} caracteres.`)
            .max(max, `${label} no puede superar ${max} caracteres.`));

const v = {
    id: z.coerce.number().int().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.').refine(isValidDate, 'Fecha inválida.'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horario inválido (HH:MM).'),
    email: z.string().trim().toLowerCase().max(120, 'Correo demasiado largo.')
        .email('Correo inválido.'),
    password: z.string()
        .min(8, 'La contraseña debe tener al menos 8 caracteres.')
        .max(72, 'La contraseña no puede superar 72 caracteres.')
        // bcrypt solo usa los primeros 72 BYTES: con tildes o ñ, 72 caracteres pueden ser más bytes
        // y dos contraseñas distintas terminarían valiendo lo mismo. Por eso se mide en bytes.
        .refine(p => Buffer.byteLength(p, 'utf8') <= 72, 'La contraseña es demasiado larga.')
        .refine(p => !/\s/.test(p), 'La contraseña no puede tener espacios.')
        .refine(p => /[A-Za-z]/.test(p) && /\d/.test(p), 'La contraseña debe tener letras y números.'),
    price: z.preprocess(x => (x === '' || x === null ? undefined : x),
        z.coerce.number({ invalid_type_error: 'Ingresá el precio.', required_error: 'Ingresá el precio.' })
            .int('El precio debe ser un número entero.').min(0, 'Precio inválido.').max(100_000_000, 'Precio demasiado alto.')),
    bool: z.union([z.boolean(), z.literal(0), z.literal(1), z.literal('0'), z.literal('1'), z.literal('true'), z.literal('false')])
        .transform(x => x === true || x === 1 || x === '1' || x === 'true'),
    text: cleanText,
    phone: z.string().trim().max(30).regex(/^[0-9+\-\s()]*$/, 'Teléfono inválido.').optional().or(z.literal('')),
    hexColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido (formato #RRGGBB).'),
};

/* =========================================================
   FECHAS (siempre en hora de Argentina, sin importar dónde corra el server)
   ========================================================= */
function isValidDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function todayStr(now = new Date()) { return fmtDate.format(now); }
function nowTimeStr(now = new Date()) { return fmtTime.format(now); }
function weekdayOf(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.toISOString().slice(0, 10);
}
function diffDays(a, b) { // b - a en días
    const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
/** Lunes de la semana de una fecha (semana lunes→domingo). */
function weekStart(dateStr) {
    const wd = weekdayOf(dateStr);
    return addDays(dateStr, wd === 0 ? -6 : 1 - wd);
}
/** Minutos que faltan para fecha+hora (en hora local del gym). Negativo si ya pasó. */
function minutesUntil(dateStr, timeStr, now = new Date()) {
    const days = diffDays(todayStr(now), dateStr);
    const [h, m] = timeStr.split(':').map(Number);
    const [nh, nm] = nowTimeStr(now).split(':').map(Number);
    return days * 1440 + (h * 60 + m) - (nh * 60 + nm);
}

/* =========================================================
   CONFIGURACIÓN EDITABLE (tabla settings)
   ========================================================= */
const SETTINGS_DEFAULTS = Object.fromEntries(Object.entries(require('../seed-data').settings).map(([k, v]) => [k, String(v)]));
// Claves que se pueden mostrar al público (las demás solo las ve el admin).
const PUBLIC_SETTINGS = Object.keys(SETTINGS_DEFAULTS);

function getSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const out = { ...SETTINGS_DEFAULTS };
    for (const r of rows) out[r.key] = r.value;
    return out;
}

/* =========================================================
   AUDITORÍA
   ========================================================= */
const insAudit = db.prepare('INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)');
function audit(req, action, detail, userId) {
    try {
        insAudit.run(userId ?? req?.user?.id ?? null, action, detail ? String(detail).slice(0, 500) : null, req?.ip ?? null, Date.now());
    } catch (e) { /* la auditoría nunca debe romper la petición */ }
}

module.exports = {
    HttpError, httpError, notFound, parse, v, z,
    todayStr, nowTimeStr, weekdayOf, addDays, diffDays, weekStart, minutesUntil, isValidDate,
    getSettings, SETTINGS_DEFAULTS, PUBLIC_SETTINGS, audit,
};
