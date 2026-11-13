'use strict';
/** Todo lo del usuario logueado: perfil, planes, pagos y calendario. */
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { parse, v, z, httpError, notFound, audit, getSettings, todayStr } = require('../lib/util');
const { requireUser, requireMember } = require('../security/auth');
const P = require('../services/payments');
const { userCalendar } = require('../services/calendar');

const router = express.Router();
router.use(requireUser);

const payLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => 'u' + req.user.id,
    message: { error: 'Demasiados intentos de pago. Esperá unos minutos.' },
});

const paymentView = (p) => p && ({
    id: p.id, description: p.description, amount: p.amount, method: p.method, status: p.status,
    transfer_ref: p.transfer_ref,
    admin_note: p.admin_note, created_at: p.created_at, updated_at: p.updated_at,
});

/* ---------- Resumen de la cuenta ---------- */
router.get('/overview', (req, res) => {
    const uid = req.user.id;
    res.json({
        user: req.user,
        subscriptions: db.prepare(`SELECT s.id, s.plan_name, s.kind, a.name AS activity_name, s.weekly_limit, s.price,
                                          s.start_date, s.end_date, s.status
                                   FROM subscriptions s LEFT JOIN activities a ON a.id = s.activity_id
                                   WHERE s.user_id = ? AND s.status <> 'cancelada'
                                   ORDER BY s.end_date DESC LIMIT 50`).all(uid),
        payments: db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(uid).map(paymentView),
        // Planes con un pago sin terminar (pendiente o en revisión): la página muestra "Continuar pago" en vez de "Contratar".
        openPlans: db.prepare(`SELECT s.plan_id, p.id AS payment_id, p.status FROM payments p
                               JOIN subscriptions s ON s.id = p.subscription_id
                               WHERE p.user_id = ? AND p.status IN ('pendiente', 'en_revision')`).all(uid),
    });
});

router.get('/calendar', (req, res) => {
    const { month } = parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido.') }), req.query);
    res.json(userCalendar(req.user.id, month));
});

/* ---------- Perfil ---------- */
router.patch('/profile', (req, res) => {
    const data = parse(z.object({
        name: v.text(2, 40, 'El nombre'),
        lastname: v.text(2, 40, 'El apellido'),
        phone: v.phone,
    }), req.body);
    if (!/^[\p{L}' .-]+$/u.test(data.name) || !/^[\p{L}' .-]+$/u.test(data.lastname)) {
        throw httpError(400, 'Nombre y apellido solo pueden tener letras.');
    }
    db.prepare('UPDATE users SET name = ?, lastname = ?, phone = ? WHERE id = ?')
        .run(data.name, data.lastname, data.phone || null, req.user.id);
    audit(req, 'cuenta.perfil');
    res.json({ ok: true });
});

/* ---------- Contratar un plan ---------- */
router.post('/plans/:id/purchase', requireMember, (req, res) => {
    const { id } = parse(z.object({ id: v.id }), req.params);
    const plan = db.prepare(`SELECT p.* FROM plans p LEFT JOIN activities a ON a.id = p.activity_id
                             WHERE p.id = ? AND p.active = 1 AND (p.activity_id IS NULL OR a.active = 1)
                               AND (p.promo_until IS NULL OR p.promo_until >= ?)`).get(id, todayStr());   // promo vencida: no se puede contratar
    if (!plan) throw notFound('Plan');
    const pay = P.startPlanPurchase(req.user.id, plan);
    audit(req, 'plan.solicitar', `${plan.name} → pago #${pay.id}`);
    res.status(201).json({ payment: paymentView(pay) });
});

/* ---------- Pagos ---------- */
function ownPayment(req) {
    const { id } = parse(z.object({ id: v.id }), req.params);
    const p = db.prepare('SELECT * FROM payments WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!p) throw notFound('Pago');
    return p;
}
function assertOpen(p) {
    if (p.status !== 'pendiente') {
        throw httpError(409, p.status === 'en_revision' ? 'Ese pago ya está en revisión.' : 'Ese pago ya fue procesado.');
    }
}

router.get('/payments/:id', (req, res) => {
    const p = ownPayment(req);
    const s = getSettings();
    res.json({
        payment: paymentView(p),
        transfer: { alias: s.transfer_alias, cbu: s.transfer_cbu, holder: s.transfer_holder },
    });
});

router.post('/payments/:id/transfer', payLimiter, requireMember, (req, res) => {
    const p = ownPayment(req);
    assertOpen(p);
    const { reference } = parse(z.object({ reference: v.text(3, 60, 'El número de operación') }), req.body);
    const updated = P.markInReview(p.id, 'transferencia', reference);
    audit(req, 'pago.transferencia_informada', `#${p.id}`);
    res.json({ payment: paymentView(updated) });
});

router.post('/payments/:id/cash', payLimiter, requireMember, (req, res) => {
    const p = ownPayment(req);
    assertOpen(p);
    const updated = P.markInReview(p.id, 'efectivo');
    audit(req, 'pago.efectivo_elegido', `#${p.id}`);
    res.json({ payment: paymentView(updated) });
});

router.post('/payments/:id/cancel', (req, res) => {
    const p = ownPayment(req);
    if (!['pendiente', 'en_revision'].includes(p.status)) throw httpError(409, 'Ese pago ya fue procesado.');
    const updated = P.close(p.id, 'cancelado', null, 'Cancelado por el usuario');
    audit(req, 'pago.cancelar', `#${p.id}`);
    res.json({ payment: paymentView(updated) });
});

module.exports = router;
module.exports.paymentView = paymentView;
