'use strict';
/**
 * API del panel de administración. TODAS las rutas exigen:
 * sesión válida + rol admin (leído de la base) + código de administrador verificado en esta sesión.
 */
const express = require('express');
const db = require('../db');
const {
    parse, v, z, httpError, notFound, audit, todayStr, addDays, weekdayOf,
    getSettings, SETTINGS_DEFAULTS,
} = require('../lib/util');
const { requireAdmin, destroyUserSessions } = require('../security/auth');
const B = require('../services/booking');
const P = require('../services/payments');
const { userCalendar } = require('../services/calendar');
const { singleImage, saveProductImage, deleteProductImage } = require('../services/uploads');
const { paymentView } = require('./account');
const fs = require('fs');
const ah = require('../lib/ah');
const pw = require('../security/passwords');
const T = require('../services/teachers');
const knowledge = require('../services/knowledge');
const assistant = require('../services/assistant');

const router = express.Router();
router.use(requireAdmin);

// Cada cambio exitoso del admin regenera el CSV público del asistente, así nunca queda desactualizado.
router.use((req, res, next) => {
    if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) knowledge.scheduleExport(); });
    next();
});

const idParam = (req) => parse(z.object({ id: v.id }), req.params).id;
const ICONS = ['pesa', 'pulso', 'rayo', 'reloj', 'corazon', 'fuego', 'persona', 'bici'];

/* =========================================================
   RESUMEN
   ========================================================= */
router.get('/stats', (req, res) => {
    const today = todayStr();
    const q = (sql, ...a) => db.prepare(sql).get(...a).c;
    res.json({
        reservationsToday: q(`SELECT COUNT(*) c FROM reservations WHERE status='activa' AND date = ?`, today),
        reservationsWeek: q(`SELECT COUNT(*) c FROM reservations WHERE status='activa' AND date BETWEEN ? AND ?`, today, addDays(today, 6)),
        users: q(`SELECT COUNT(*) c FROM users WHERE role = 'user'`),
        activeMembers: q(`SELECT COUNT(DISTINCT user_id) c FROM subscriptions WHERE status='activa' AND start_date <= ? AND end_date >= ?`, today, today),
        paymentsToReview: q(`SELECT COUNT(*) c FROM payments WHERE status = 'en_revision'`),
        incomeMonth: db.prepare(`SELECT COALESCE(SUM(amount),0) c FROM payments WHERE status='aprobado' AND updated_at >= ?`)
            .get(Date.parse(today.slice(0, 7) + '-01T00:00:00-03:00')).c,
        activeBlocks: q(`SELECT (SELECT COUNT(*) FROM blocked_days WHERE date >= ?) + (SELECT COUNT(*) FROM blocked_slots WHERE date >= ?) c`, today, today),
    });
});

/* =========================================================
   RESERVAS
   ========================================================= */
router.get('/reservations', (req, res) => {
    const f = parse(z.object({
        date: v.date.optional().or(z.literal('')),
        activity: v.id.optional().or(z.literal('')),
        status: z.enum(['activa', 'cancelada', '']).optional(),
        q: z.string().max(60).optional(),
        scope: z.enum(['futuras', 'pasadas', 'todas', '']).optional(),
    }), req.query);
    const where = [], args = [];
    const today = todayStr();
    if (f.date) { where.push('r.date = ?'); args.push(f.date); }
    if (f.activity) { where.push('r.activity_id = ?'); args.push(f.activity); }
    if (f.status) { where.push('r.status = ?'); args.push(f.status); }
    if (f.scope === 'futuras') { where.push('r.date >= ?'); args.push(today); }
    if (f.scope === 'pasadas') { where.push('r.date < ?'); args.push(today); }
    if (f.q) {
        where.push(`(u.name || ' ' || u.lastname LIKE ? OR u.email LIKE ?)`);
        const like = `%${f.q.replace(/[%_]/g, '')}%`;
        args.push(like, like);
    }
    const rows = db.prepare(`SELECT r.id, r.date, r.start_time, r.end_time, r.activity_id, r.activity_name, r.ticket, r.status,
                                    r.cancel_reason, u.id AS user_id, u.name || ' ' || u.lastname AS user_name, u.email, a.color
                             FROM reservations r JOIN users u ON u.id = r.user_id
                             LEFT JOIN activities a ON a.id = r.activity_id
                             ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                             ORDER BY (r.date < ?), r.date ${f.scope === 'pasadas' ? 'DESC' : 'ASC'}, r.start_time
                             LIMIT 500`).all(...args, today);
    res.json({ reservations: rows });
});

router.post('/reservations/:id/cancel', (req, res) => {
    const id = idParam(req);
    const { reason } = parse(z.object({ reason: v.text(0, 120, 'El motivo').optional() }), req.body || {});
    const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
    if (!r) throw notFound('Reserva');
    if (r.status !== 'activa') throw httpError(400, 'La reserva ya estaba cancelada.');
    B.cancelReservation(id, reason || 'Cancelada por el gimnasio');
    audit(req, 'admin.reserva_cancelar', `#${id}`);
    res.json({ ok: true });
});

/* =========================================================
   USUARIOS
   ========================================================= */
router.get('/users', (req, res) => {
    const { q } = parse(z.object({ q: z.string().max(60).optional() }), req.query);
    const today = todayStr();
    const like = `%${(q || '').replace(/[%_]/g, '')}%`;
    const rows = db.prepare(`SELECT u.id, u.name, u.lastname, u.email, u.phone, u.role, u.active, u.created_at,
                                    (SELECT COUNT(*) FROM reservations r WHERE r.user_id = u.id AND r.status='activa' AND r.date >= ?) AS upcoming,
                                    (SELECT GROUP_CONCAT(plan_name, ', ') FROM subscriptions s
                                       WHERE s.user_id = u.id AND s.status='activa' AND s.start_date <= ? AND s.end_date >= ?) AS plans
                             FROM users u
                             WHERE (u.name || ' ' || u.lastname LIKE ? OR u.email LIKE ?)
                             ORDER BY u.role DESC, u.created_at DESC LIMIT 300`).all(today, today, today, like, like);
    res.json({ users: rows });
});

router.get('/users/:id', (req, res) => {
    const id = idParam(req);
    const user = db.prepare('SELECT id, name, lastname, email, phone, role, active, created_at FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('Usuario');
    res.json({
        user,
        subscriptions: db.prepare(`SELECT s.*, a.name AS activity_name FROM subscriptions s LEFT JOIN activities a ON a.id = s.activity_id
                                   WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 50`).all(id),
        payments: db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(id).map(paymentView),
        stats: {
            total: db.prepare(`SELECT COUNT(*) c FROM reservations WHERE user_id = ? AND status='activa'`).get(id).c,
            upcoming: db.prepare(`SELECT COUNT(*) c FROM reservations WHERE user_id = ? AND status='activa' AND date >= ?`).get(id, todayStr()).c,
        },
    });
});

router.get('/users/:id/calendar', (req, res) => {
    const id = idParam(req);
    const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido.') }), req.query);
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) throw notFound('Usuario');
    res.json(userCalendar(id, month));
});

router.patch('/users/:id', (req, res) => {
    const id = idParam(req);
    const { active } = parse(z.object({ active: v.bool }), req.body);
    if (id === req.user.id) throw httpError(400, 'No podés desactivar tu propia cuenta.');
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
    if (!u) throw notFound('Usuario');
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    if (!active) destroyUserSessions(id); // lo desloguea de todos lados
    audit(req, active ? 'admin.usuario_activar' : 'admin.usuario_desactivar', `#${id}`);
    res.json({ ok: true });
});

router.post('/users/:id/grant-plan', (req, res) => {
    const id = idParam(req);
    const { planId, method } = parse(z.object({ planId: v.id, method: z.enum(['efectivo', 'transferencia']) }), req.body);
    if (!db.prepare(`SELECT 1 FROM users WHERE id = ? AND role = 'user'`).get(id)) throw notFound('Usuario');
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
    if (!plan) throw notFound('Plan');
    const pay = P.startPlanPurchase(id, plan, { method, status: 'aprobado', reviewerId: req.user.id });
    audit(req, 'admin.plan_asignar', `usuario #${id} ${plan.name} (${method})`);
    res.status(201).json({ payment: paymentView(pay) });
});

/* =========================================================
   ACTIVIDADES Y HORARIOS
   ========================================================= */
const activitySchema = z.object({
    name: v.text(2, 50, 'El nombre'),
    short_name: v.text(2, 20, 'El nombre corto'),
    description: v.text(0, 300, 'La descripción'),
    color: v.hexColor,
    icon: z.enum(ICONS),
    location: v.text(0, 60, 'La sede o sala').optional().default(''),
    active: v.bool,
    sort_order: z.coerce.number().int().min(0).max(999).default(0),
});
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'actividad';

router.get('/activities', (req, res) => {
    const acts = db.prepare('SELECT * FROM activities ORDER BY sort_order, id').all();
    const slots = db.prepare('SELECT * FROM schedule_slots ORDER BY weekday, start_time').all();
    const st = db.prepare(`SELECT st.slot_id, u.id, u.name, u.lastname FROM slot_teachers st JOIN users u ON u.id = st.teacher_id
                           WHERE u.role = 'profe' AND u.active = 1 ORDER BY u.name`).all();
    const withTeachers = (s) => ({ ...s, teachers: st.filter(t => t.slot_id === s.id).map(t => ({ id: t.id, name: `${t.name} ${t.lastname}` })) });
    res.json({ activities: acts.map(a => ({ ...a, slots: slots.filter(s => s.activity_id === a.id).map(withTeachers) })), icons: ICONS });
});

router.post('/activities', (req, res) => {
    const d = parse(activitySchema, req.body);
    let slug = slugify(d.name), i = 2;
    while (db.prepare('SELECT 1 FROM activities WHERE slug = ?').get(slug)) slug = `${slugify(d.name)}-${i++}`;
    const info = db.prepare(`INSERT INTO activities (slug, name, short_name, description, color, icon, location, active, sort_order)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(slug, d.name, d.short_name, d.description, d.color, d.icon, d.location, d.active ? 1 : 0, d.sort_order);
    audit(req, 'admin.actividad_crear', d.name);
    res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/activities/:id', (req, res) => {
    const id = idParam(req);
    const d = parse(activitySchema, req.body);
    const info = db.prepare(`UPDATE activities SET name=?, short_name=?, description=?, color=?, icon=?, location=?, active=?, sort_order=? WHERE id=?`)
        .run(d.name, d.short_name, d.description, d.color, d.icon, d.location, d.active ? 1 : 0, d.sort_order, id);
    if (!info.changes) throw notFound('Actividad');
    audit(req, 'admin.actividad_editar', `#${id} ${d.name}`);
    res.json({ ok: true });
});

router.delete('/activities/:id', (req, res) => {
    const id = idParam(req);
    if (db.prepare('SELECT 1 FROM reservations WHERE activity_id = ? LIMIT 1').get(id)) {
        throw httpError(409, 'Esa actividad tiene reservas registradas. Desactivala en lugar de borrarla.');
    }
    if (db.prepare('SELECT 1 FROM plans WHERE activity_id = ? LIMIT 1').get(id)) {
        throw httpError(409, 'Hay planes que usan esta actividad. Borralos o cambialos primero.');
    }
    const info = db.prepare('DELETE FROM activities WHERE id = ?').run(id);
    if (!info.changes) throw notFound('Actividad');
    audit(req, 'admin.actividad_borrar', `#${id}`);
    res.json({ ok: true });
});

const slotSchema = z.object({
    activity_id: v.id,
    weekday: z.coerce.number().int().min(0).max(6),
    start_time: v.time,
    end_time: v.time,
    capacity: z.coerce.number().int().min(1, 'Cupo mínimo 1.').max(100, 'Cupo máximo 100.'),
    active: v.bool,
}).refine(s => s.end_time > s.start_time, { message: 'La hora de fin tiene que ser posterior a la de inicio.', path: ['end_time'] });

/** Cancela reservas futuras afectadas por un cambio de horario. Devuelve cuántas. */
function cancelFutureForSlot(slotId, reason, onlyTicketsAbove = null) {
    const today = todayStr();
    const sql = `UPDATE reservations SET status='cancelada', cancel_reason=?, cancelled_at=?
                 WHERE slot_id = ? AND status='activa' AND date >= ?` + (onlyTicketsAbove ? ' AND ticket > ?' : '');
    const args = [reason, Date.now(), slotId, today];
    if (onlyTicketsAbove) args.push(onlyTicketsAbove);
    return db.prepare(sql).run(...args).changes;
}

router.post('/slots', (req, res) => {
    const d = parse(slotSchema, req.body);
    if (!db.prepare('SELECT 1 FROM activities WHERE id = ?').get(d.activity_id)) throw notFound('Actividad');
    const info = db.prepare(`INSERT INTO schedule_slots (activity_id, weekday, start_time, end_time, capacity, active) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(d.activity_id, d.weekday, d.start_time, d.end_time, d.capacity, d.active ? 1 : 0);
    audit(req, 'admin.horario_crear', `act #${d.activity_id} día ${d.weekday} ${d.start_time}`);
    res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/slots/:id', (req, res) => {
    const id = idParam(req);
    const d = parse(slotSchema, req.body);
    const old = db.prepare('SELECT * FROM schedule_slots WHERE id = ?').get(id);
    if (!old) throw notFound('Horario');
    const cancelled = db.tx(() => {
        let n = 0;
        if (old.weekday !== d.weekday || old.start_time !== d.start_time || old.end_time !== d.end_time
            || old.activity_id !== d.activity_id || (old.active && !d.active)) {
            n += cancelFutureForSlot(id, 'El gimnasio modificó este horario');
        } else if (d.capacity < old.capacity) {
            n += cancelFutureForSlot(id, 'El gimnasio redujo el cupo de la clase', d.capacity);
        }
        db.prepare('UPDATE schedule_slots SET activity_id=?, weekday=?, start_time=?, end_time=?, capacity=?, active=? WHERE id=?')
            .run(d.activity_id, d.weekday, d.start_time, d.end_time, d.capacity, d.active ? 1 : 0, id);
        return n;
    });
    audit(req, 'admin.horario_editar', `#${id} (${cancelled} reservas canceladas)`);
    res.json({ ok: true, cancelledReservations: cancelled });
});

router.delete('/slots/:id', (req, res) => {
    const id = idParam(req);
    const cancelled = db.tx(() => {
        const n = cancelFutureForSlot(id, 'El gimnasio eliminó este horario');
        const info = db.prepare('DELETE FROM schedule_slots WHERE id = ?').run(id);
        if (!info.changes) throw notFound('Horario');
        return n;
    });
    audit(req, 'admin.horario_borrar', `#${id} (${cancelled} reservas canceladas)`);
    res.json({ ok: true, cancelledReservations: cancelled });
});

/* =========================================================
   HORARIO DE APERTURA DEL GYM
   ========================================================= */
router.get('/opening-hours', (req, res) => {
    res.json({ hours: db.prepare('SELECT * FROM opening_hours ORDER BY weekday').all() });
});

router.put('/opening-hours', (req, res) => {
    const { hours } = parse(z.object({
        hours: z.array(z.object({
            weekday: z.coerce.number().int().min(0).max(6),
            is_open: v.bool,
            open_time: v.time.nullable().optional().or(z.literal('')),
            close_time: v.time.nullable().optional().or(z.literal('')),
        })).length(7, 'Tienen que ser los 7 días.'),
    }), req.body);
    for (const h of hours) {
        if (h.is_open && (!h.open_time || !h.close_time || h.close_time <= h.open_time)) {
            throw httpError(400, 'Revisá los horarios: el cierre tiene que ser después de la apertura.');
        }
    }
    const up = db.prepare(`INSERT INTO opening_hours (weekday, is_open, open_time, close_time) VALUES (?, ?, ?, ?)
                           ON CONFLICT(weekday) DO UPDATE SET is_open=excluded.is_open, open_time=excluded.open_time, close_time=excluded.close_time`);
    db.tx(() => hours.forEach(h => up.run(h.weekday, h.is_open ? 1 : 0, h.is_open ? h.open_time : null, h.is_open ? h.close_time : null)));
    audit(req, 'admin.apertura_editar');
    res.json({ ok: true });
});

/* =========================================================
   PLANES Y PRECIOS
   ========================================================= */
const planSchema = z.object({
    name: v.text(2, 60, 'El nombre'),
    description: v.text(0, 300, 'La descripción'),
    kind: z.enum(['membresia', 'actividad']),
    activity_id: v.id.nullable().optional().or(z.literal('')),
    price: v.price,
    duration_days: z.coerce.number().int().min(1, 'Duración mínima 1 día.').max(366, 'Duración máxima 366 días.'),
    weekly_limit: z.coerce.number().int().min(1).max(14).nullable().optional().or(z.literal('')),
    featured: v.bool,
    active: v.bool,
    sort_order: z.coerce.number().int().min(0).max(999).default(0),
    // PROMO: vacío = plan normal; con fecha = promo que se oculta sola pasado ese día.
    promo_until: z.preprocess(x => (x === '' || x === undefined ? null : x), v.date.nullable()),
}).transform(p => ({
    ...p,
    activity_id: p.kind === 'actividad' ? (p.activity_id || null) : null,
    weekly_limit: p.weekly_limit || null,
})).refine(p => p.kind === 'membresia' || p.activity_id, { message: 'Elegí la actividad del plan.', path: ['activity_id'] });

router.get('/plans', (req, res) => {
    res.json({ plans: db.prepare(`SELECT p.*, a.name AS activity_name FROM plans p LEFT JOIN activities a ON a.id = p.activity_id
                                  ORDER BY p.sort_order, p.id`).all() });
});

router.post('/plans', (req, res) => {
    const d = parse(planSchema, req.body);
    if (d.activity_id && !db.prepare('SELECT 1 FROM activities WHERE id = ?').get(d.activity_id)) throw notFound('Actividad');
    if (d.promo_until && d.promo_until < todayStr()) throw httpError(400, 'La fecha de fin de la promo ya pasó.', { field: 'promo_until' });
    const info = db.prepare(`INSERT INTO plans (name, description, kind, activity_id, price, duration_days, weekly_limit, featured, active, sort_order, promo_until)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(d.name, d.description, d.kind, d.activity_id, d.price, d.duration_days, d.weekly_limit, d.featured ? 1 : 0, d.active ? 1 : 0, d.sort_order, d.promo_until);
    audit(req, 'admin.plan_crear', `${d.name} $${d.price}`);
    res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/plans/:id', (req, res) => {
    const id = idParam(req);
    const d = parse(planSchema, req.body);
    if (d.activity_id && !db.prepare('SELECT 1 FROM activities WHERE id = ?').get(d.activity_id)) throw notFound('Actividad');
    const info = db.prepare(`UPDATE plans SET name=?, description=?, kind=?, activity_id=?, price=?, duration_days=?, weekly_limit=?,
                             featured=?, active=?, sort_order=?, promo_until=? WHERE id=?`)
        .run(d.name, d.description, d.kind, d.activity_id, d.price, d.duration_days, d.weekly_limit, d.featured ? 1 : 0, d.active ? 1 : 0, d.sort_order, d.promo_until, id);
    if (!info.changes) throw notFound('Plan');
    audit(req, 'admin.plan_editar', `#${id} ${d.name} $${d.price}`);
    res.json({ ok: true });
});

router.delete('/plans/:id', (req, res) => {
    const id = idParam(req);
    // Las suscripciones guardan nombre y precio propios, así que el historial no se pierde.
    const info = db.prepare('DELETE FROM plans WHERE id = ?').run(id);
    if (!info.changes) throw notFound('Plan');
    audit(req, 'admin.plan_borrar', `#${id}`);
    res.json({ ok: true });
});

/* =========================================================
   PAGOS
   ========================================================= */
router.get('/payments', (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['pendiente', 'en_revision', 'aprobado', 'rechazado', 'cancelado', '']).optional() }), req.query);
    const rows = db.prepare(`SELECT p.*, u.name || ' ' || u.lastname AS user_name, u.email
                             FROM payments p JOIN users u ON u.id = p.user_id
                             ${status ? 'WHERE p.status = ?' : ''}
                             ORDER BY (p.status = 'en_revision') DESC, p.created_at DESC LIMIT 500`).all(...(status ? [status] : []));
    res.json({ payments: rows.map(p => ({ ...paymentView(p), user_id: p.user_id, user_name: p.user_name, email: p.email })) });
});

router.post('/payments/:id/approve', (req, res) => {
    const id = idParam(req);
    const { note } = parse(z.object({ note: v.text(0, 200, 'La nota').optional() }), req.body || {});
    const p = P.approve(id, req.user.id, note || 'Aprobado por el administrador');
    audit(req, 'admin.pago_aprobar', `#${id} $${p.amount}`);
    res.json({ payment: paymentView(p) });
});

router.post('/payments/:id/reject', (req, res) => {
    const id = idParam(req);
    const { note } = parse(z.object({ note: v.text(0, 200, 'La nota').optional() }), req.body || {});
    const p = P.close(id, 'rechazado', req.user.id, note || 'Rechazado por el administrador');
    audit(req, 'admin.pago_rechazar', `#${id}`);
    res.json({ payment: paymentView(p) });
});

/* =========================================================
   PRODUCTOS (mostrador)
   ========================================================= */
const productSchema = z.object({
    name: v.text(2, 80, 'El nombre'),
    description: v.text(0, 300, 'La descripción'),
    category: v.text(2, 40, 'La categoría'),
    price: v.price,
    available: v.bool,
    active: v.bool,
    sort_order: z.coerce.number().int().min(0).max(999).default(0),
    remove_image: v.bool.optional(),
});

router.get('/products', (req, res) => {
    res.json({ products: db.prepare('SELECT * FROM products ORDER BY category, sort_order, name').all() });
});

router.post('/products', singleImage, (req, res) => {
    const d = parse(productSchema, req.body);
    const image = saveProductImage(req.file);
    const now = Date.now();
    const info = db.prepare(`INSERT INTO products (name, description, category, price, available, image, active, sort_order, created_at, updated_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(d.name, d.description, d.category, d.price, d.available ? 1 : 0, image, d.active ? 1 : 0, d.sort_order, now, now);
    audit(req, 'admin.producto_crear', `${d.name} $${d.price}`);
    res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/products/:id', singleImage, (req, res) => {
    const id = idParam(req);
    const d = parse(productSchema, req.body);
    const old = db.prepare('SELECT image FROM products WHERE id = ?').get(id);
    if (!old) throw notFound('Producto');
    let image = old.image;
    if (req.file) image = saveProductImage(req.file);
    else if (d.remove_image) image = null;
    db.prepare(`UPDATE products SET name=?, description=?, category=?, price=?, available=?, image=?, active=?, sort_order=?, updated_at=? WHERE id=?`)
        .run(d.name, d.description, d.category, d.price, d.available ? 1 : 0, image, d.active ? 1 : 0, d.sort_order, Date.now(), id);
    if (image !== old.image) deleteProductImage(old.image);
    audit(req, 'admin.producto_editar', `#${id} ${d.name} $${d.price}`);
    res.json({ ok: true });
});

router.delete('/products/:id', (req, res) => {
    const id = idParam(req);
    const old = db.prepare('SELECT image FROM products WHERE id = ?').get(id);
    if (!old) throw notFound('Producto');
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    deleteProductImage(old.image);
    audit(req, 'admin.producto_borrar', `#${id}`);
    res.json({ ok: true });
});

/* =========================================================
   ASISTENTE (reemplaza al FAQ): conocimiento extra en knowledge/extras_gym.csv
   ========================================================= */
const extraSchema = z.object({
    tema: v.text(2, 80, 'El tema'),
    dato: v.text(5, 1000, 'La información'),
});
const MAX_EXTRAS = 120;

router.get('/assistant', (req, res) => {
    const info = assistant.providerInfo();
    let updated = null;
    try { updated = fs.statSync(knowledge.PUBLIC_FILE).mtimeMs; } catch { }
    res.json({
        provider: info.provider, model: info.model,
        extras: knowledge.readExtras(),
        publicRows: knowledge.loadKnowledge().publicRows,
        updated,
    });
});
router.post('/assistant/extras', (req, res) => {
    const d = parse(extraSchema, req.body);
    const list = knowledge.readExtras();
    if (list.length >= MAX_EXTRAS) throw httpError(400, `Máximo ${MAX_EXTRAS} datos extra.`);
    list.push(d);
    knowledge.writeExtras(list);
    audit(req, 'admin.asistente_extra_crear', d.tema);
    res.status(201).json({ ok: true });
});
router.put('/assistant/extras/:id', (req, res) => {
    const id = idParam(req);
    const d = parse(extraSchema, req.body);
    const list = knowledge.readExtras();
    if (!list[id - 1]) throw notFound('Dato');
    list[id - 1] = d;
    knowledge.writeExtras(list);
    audit(req, 'admin.asistente_extra_editar', d.tema);
    res.json({ ok: true });
});
router.delete('/assistant/extras/:id', (req, res) => {
    const id = idParam(req);
    const list = knowledge.readExtras();
    if (!list[id - 1]) throw notFound('Dato');
    const [gone] = list.splice(id - 1, 1);
    knowledge.writeExtras(list);
    audit(req, 'admin.asistente_extra_borrar', gone.tema);
    res.json({ ok: true });
});

/* =========================================================
   PROFES
   ========================================================= */
const teacherSchema = z.object({
    name: v.text(2, 40, 'El nombre'),
    lastname: v.text(2, 40, 'El apellido'),
    phone: v.phone,
    active: v.bool.optional().default(true),
}).refine(t => /^[\p{L}' .-]+$/u.test(t.name) && /^[\p{L}' .-]+$/u.test(t.lastname), { message: 'Nombre y apellido solo pueden tener letras.', path: ['name'] });

const getTeacher = (id) => db.prepare(`SELECT id, name, lastname, email, phone, active, created_at FROM users WHERE id = ? AND role = 'profe'`).get(id);

router.get('/teachers', (req, res) => {
    const today = todayStr();
    const teachers = db.prepare(`SELECT id, name, lastname, email, phone, active, created_at FROM users WHERE role = 'profe' ORDER BY active DESC, name, lastname`).all();
    res.json({
        teachers: teachers.map(t => ({
            ...t,
            slots: T.teacherSlots(t.id).map(s => s.id),
            absences: db.prepare('SELECT COUNT(*) c FROM teacher_absences WHERE teacher_id = ? AND date >= ?').get(t.id, today).c,
        })),
        absences: T.upcomingAbsences(today, addDays(today, 60)),
    });
});

router.post('/teachers', ah(async (req, res) => {
    const d = parse(teacherSchema.and(z.object({ email: v.email, password: v.password })), req.body);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(d.email)) throw httpError(409, 'Ya existe una cuenta con ese correo.', { field: 'email' });
    const info = db.prepare(`INSERT INTO users (name, lastname, email, phone, password_hash, role, active, created_at)
                             VALUES (?, ?, ?, ?, ?, 'profe', ?, ?)`)
        .run(d.name, d.lastname, d.email, d.phone || null, await pw.hash(d.password), d.active ? 1 : 0, Date.now());
    audit(req, 'admin.profe_crear', d.email);
    res.status(201).json({ id: info.lastInsertRowid });
}));

router.put('/teachers/:id', (req, res) => {
    const id = idParam(req);
    const d = parse(teacherSchema, req.body);
    if (!getTeacher(id)) throw notFound('Profe');
    db.prepare(`UPDATE users SET name = ?, lastname = ?, phone = ?, active = ? WHERE id = ? AND role = 'profe'`)
        .run(d.name, d.lastname, d.phone || null, d.active ? 1 : 0, id);
    if (!d.active) destroyUserSessions(id);
    audit(req, 'admin.profe_editar', `#${id}`);
    knowledge.scheduleExport();
    res.json({ ok: true });
});

router.post('/teachers/:id/password', ah(async (req, res) => {
    const id = idParam(req);
    const { password } = parse(z.object({ password: v.password }), req.body);
    if (!getTeacher(id)) throw notFound('Profe');
    db.prepare(`UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ? AND role = 'profe'`).run(await pw.hash(password), id);
    destroyUserSessions(id); // las sesiones abiertas con la clave vieja dejan de valer
    audit(req, 'admin.profe_clave', `#${id}`);
    res.json({ ok: true });
}));

router.put('/teachers/:id/slots', (req, res) => {
    const id = idParam(req);
    const { slotIds } = parse(z.object({ slotIds: z.array(v.id).max(300) }), req.body);
    if (!getTeacher(id)) throw notFound('Profe');
    const unique = [...new Set(slotIds)];
    db.tx(() => {
        for (const sid of unique) if (!db.prepare('SELECT 1 FROM schedule_slots WHERE id = ?').get(sid)) throw notFound('Horario');
        db.prepare('DELETE FROM slot_teachers WHERE teacher_id = ?').run(id);
        const ins = db.prepare('INSERT INTO slot_teachers (slot_id, teacher_id, created_at) VALUES (?, ?, ?)');
        for (const sid of unique) ins.run(sid, id, Date.now());
    });
    audit(req, 'admin.profe_horarios', `#${id}: ${unique.length} horarios`);
    knowledge.scheduleExport();
    res.json({ ok: true, count: unique.length });
});

router.delete('/teachers/:id', (req, res) => {
    const id = idParam(req);
    if (!getTeacher(id)) throw notFound('Profe');
    db.prepare(`DELETE FROM users WHERE id = ? AND role = 'profe'`).run(id); // borra en cascada sesiones, horarios y ausencias
    audit(req, 'admin.profe_borrar', `#${id}`);
    knowledge.scheduleExport();
    res.json({ ok: true });
});

router.delete('/absences/:id', (req, res) => {
    const id = idParam(req);
    if (!db.prepare('DELETE FROM teacher_absences WHERE id = ?').run(id).changes) throw notFound('Aviso');
    audit(req, 'admin.ausencia_borrar', `#${id}`);
    knowledge.scheduleExport();
    res.json({ ok: true });
});

/* =========================================================
   NOTIFICACIONES
   ========================================================= */
router.get('/notifications', (req, res) => {
    res.json({ notifications: db.prepare(`SELECT n.*, p.name AS plan_name, p.promo_until FROM notifications n
                                          LEFT JOIN plans p ON p.id = n.plan_id ORDER BY n.created_at DESC`).all() });
});
router.post('/notifications', (req, res) => {
    const d = parse(z.object({
        message: v.text(5, 180, 'El mensaje'),
        type: z.enum(['info', 'warn', 'success']),
        // PROMO: opcional. Si se elige un plan en promo, el aviso sale con el botón "Ver promo".
        plan_id: z.preprocess(x => (x === '' || x === null || x === undefined ? null : x), v.id.nullable()),
    }), req.body);
    if (d.plan_id && !db.prepare('SELECT 1 FROM plans WHERE id = ? AND promo_until >= ?').get(d.plan_id, todayStr())) {
        throw httpError(400, 'Ese plan no es una promo vigente.', { field: 'plan_id' });
    }
    const info = db.prepare('INSERT INTO notifications (message, type, active, created_at, plan_id) VALUES (?, ?, 1, ?, ?)').run(d.message, d.type, Date.now(), d.plan_id);
    audit(req, 'admin.notificacion_crear');
    res.status(201).json({ id: info.lastInsertRowid });
});
router.patch('/notifications/:id', (req, res) => {
    const id = idParam(req);
    const { active } = parse(z.object({ active: v.bool }), req.body);
    if (!db.prepare('UPDATE notifications SET active = ? WHERE id = ?').run(active ? 1 : 0, id).changes) throw notFound('Notificación');
    res.json({ ok: true });
});
router.delete('/notifications/:id', (req, res) => {
    const id = idParam(req);
    if (!db.prepare('DELETE FROM notifications WHERE id = ?').run(id).changes) throw notFound('Notificación');
    audit(req, 'admin.notificacion_borrar', `#${id}`);
    res.json({ ok: true });
});

/* =========================================================
   BLOQUEOS (días y horarios puntuales)
   ========================================================= */
router.get('/blocks', (req, res) => {
    const today = todayStr();
    res.json({
        days: db.prepare('SELECT * FROM blocked_days WHERE date >= ? ORDER BY date').all(today),
        slots: db.prepare(`SELECT b.id, b.date, b.reason, s.start_time, s.end_time, a.name AS activity_name
                           FROM blocked_slots b JOIN schedule_slots s ON s.id = b.slot_id JOIN activities a ON a.id = s.activity_id
                           WHERE b.date >= ? ORDER BY b.date, s.start_time`).all(today),
    });
});

router.post('/blocks/day', (req, res) => {
    const d = parse(z.object({ date: v.date, reason: v.text(0, 80, 'El motivo').optional() }), req.body);
    if (d.date < todayStr()) throw httpError(400, 'No podés bloquear fechas pasadas.');
    const reason = d.reason || 'No disponible';
    const cancelled = db.tx(() => {
        db.prepare(`INSERT INTO blocked_days (date, reason, created_at) VALUES (?, ?, ?)
                    ON CONFLICT(date) DO UPDATE SET reason = excluded.reason`).run(d.date, reason, Date.now());
        return db.prepare(`UPDATE reservations SET status='cancelada', cancel_reason=?, cancelled_at=? WHERE date = ? AND status='activa'`)
            .run(`Día bloqueado: ${reason}`, Date.now(), d.date).changes;
    });
    audit(req, 'admin.bloqueo_dia', `${d.date} (${cancelled} reservas canceladas)`);
    res.status(201).json({ ok: true, cancelledReservations: cancelled });
});

router.delete('/blocks/day/:date', (req, res) => {
    const { date } = parse(z.object({ date: v.date }), req.params);
    if (!db.prepare('DELETE FROM blocked_days WHERE date = ?').run(date).changes) throw notFound('Bloqueo');
    audit(req, 'admin.desbloqueo_dia', date);
    res.json({ ok: true });
});

router.post('/blocks/slot', (req, res) => {
    const d = parse(z.object({ slotId: v.id, date: v.date, reason: v.text(0, 80, 'El motivo').optional() }), req.body);
    if (d.date < todayStr()) throw httpError(400, 'No podés bloquear fechas pasadas.');
    const slot = db.prepare('SELECT * FROM schedule_slots WHERE id = ?').get(d.slotId);
    if (!slot) throw notFound('Horario');
    if (weekdayOf(d.date) !== slot.weekday) throw httpError(400, 'Ese horario no se dicta ese día.');
    const reason = d.reason || 'No disponible';
    const cancelled = db.tx(() => {
        db.prepare(`INSERT INTO blocked_slots (slot_id, date, reason, created_at) VALUES (?, ?, ?, ?)
                    ON CONFLICT(slot_id, date) DO UPDATE SET reason = excluded.reason`).run(d.slotId, d.date, reason, Date.now());
        return db.prepare(`UPDATE reservations SET status='cancelada', cancel_reason=?, cancelled_at=? WHERE slot_id = ? AND date = ? AND status='activa'`)
            .run(`Horario bloqueado: ${reason}`, Date.now(), d.slotId, d.date).changes;
    });
    audit(req, 'admin.bloqueo_horario', `slot #${d.slotId} ${d.date} (${cancelled} reservas canceladas)`);
    res.status(201).json({ ok: true, cancelledReservations: cancelled });
});

router.delete('/blocks/slot/:id', (req, res) => {
    const id = idParam(req);
    if (!db.prepare('DELETE FROM blocked_slots WHERE id = ?').run(id).changes) throw notFound('Bloqueo');
    audit(req, 'admin.desbloqueo_horario', `#${id}`);
    res.json({ ok: true });
});

/* =========================================================
   CONFIGURACIÓN GENERAL
   ========================================================= */
const settingsSchema = z.object({
    address: v.text(5, 120, 'La dirección'),
    phone: v.text(6, 30, 'El teléfono'),
    whatsapp: z.string().trim().regex(/^\d{8,15}$/, 'WhatsApp: solo números con código de país (ej: 5492235282837).'),
    instagram: z.string().trim().regex(/^[A-Za-z0-9._]{1,30}$/, 'Usuario de Instagram inválido (sin @).'),
    facebook_url: z.string().trim().max(200).url('Link de Facebook inválido.')
        .refine(u => /^https:\/\/(www\.)?facebook\.com(\/|$)/.test(u), 'El link tiene que ser de facebook.com.').or(z.literal('')),
    contact_email: v.email.or(z.literal('')),
    transfer_alias: v.text(3, 40, 'El alias'),
    transfer_cbu: z.string().trim().regex(/^\d{22}$/, 'El CBU/CVU tiene 22 dígitos.'),
    transfer_holder: v.text(3, 80, 'El titular'),
    require_plan_to_reserve: v.bool,
    booking_days_ahead: z.coerce.number().int().min(1).max(60),
    cancel_min_hours: z.coerce.number().int().min(0).max(72),
    schedule_note: v.text(0, 200, 'La nota de horarios'),
});

router.get('/settings', (req, res) => res.json({ settings: getSettings() }));

router.put('/settings', (req, res) => {
    const d = parse(settingsSchema, req.body);
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    db.tx(() => {
        for (const k of Object.keys(SETTINGS_DEFAULTS)) {
            if (!(k in d)) continue;
            const val = typeof d[k] === 'boolean' ? (d[k] ? '1' : '0') : String(d[k]);
            up.run(k, val);
        }
    });
    audit(req, 'admin.config_editar');
    res.json({ ok: true });
});

/* =========================================================
   AUDITORÍA
   ========================================================= */
router.get('/audit', (req, res) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
    res.json({
        entries: db.prepare(`SELECT l.id, l.action, l.detail, l.ip, l.created_at, u.email
                             FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
                             ORDER BY l.id DESC LIMIT ?`).all(limit),
    });
});

module.exports = router;
