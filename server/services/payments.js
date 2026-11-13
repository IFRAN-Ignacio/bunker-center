'use strict';
/**
 * Pagos de planes (mensualidad y actividades).
 *
 * Medios aceptados: TRANSFERENCIA (el socio informa el número de operación) y EFECTIVO
 * (paga en la recepción). En los dos casos el pago queda "en revisión" hasta que el
 * administrador lo aprueba o lo rechaza. No hay pago con tarjeta: la página nunca maneja
 * datos de tarjetas. Los datos para transferir (alias, CBU/CVU, titular) salen de la tabla
 * settings y se cambian desde Admin -> Configuración.
 */
const db = require('../db');
const { httpError, todayStr, addDays } = require('../lib/util');

/* ---------- Ciclo de vida ---------- */
const getPayment = (id) => db.prepare('SELECT * FROM payments WHERE id = ?').get(id);

/** Crea suscripción pendiente + pago pendiente. Si ya hay un pago abierto para ese plan, lo reutiliza. */
function startPlanPurchase(userId, plan, { method = null, status = 'pendiente', reviewerId = null } = {}) {
    return db.tx(() => {
        const open = db.prepare(`SELECT p.id FROM payments p JOIN subscriptions s ON s.id = p.subscription_id
                                 WHERE p.user_id = ? AND s.plan_id = ? AND p.status IN ('pendiente', 'en_revision')`)
            .get(userId, plan.id);
        if (open && status === 'pendiente') return getPayment(open.id);

        // Si ya tiene ese plan vigente, el nuevo período arranca cuando termina el actual (renovación).
        const today = todayStr();
        const last = db.prepare(`SELECT MAX(end_date) d FROM subscriptions
                                 WHERE user_id = ? AND plan_id = ? AND status = 'activa' AND end_date >= ?`)
            .get(userId, plan.id, today).d;
        const start = last ? addDays(last, 1) : today;
        const end = addDays(start, plan.duration_days - 1);
        const now = Date.now();

        const sub = db.prepare(`INSERT INTO subscriptions
            (user_id, plan_id, plan_name, kind, activity_id, weekly_limit, price, start_date, end_date, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)`)
            .run(userId, plan.id, plan.name, plan.kind, plan.activity_id, plan.weekly_limit, plan.price, start, end, now);

        const desc = `${plan.name} (${start.split('-').reverse().join('/')} al ${end.split('-').reverse().join('/')})`;
        const pay = db.prepare(`INSERT INTO payments
            (user_id, subscription_id, description, amount, method, status, reviewed_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)`)
            .run(userId, sub.lastInsertRowid, desc, plan.price, method, reviewerId, now, now);

        if (status === 'aprobado') approve(pay.lastInsertRowid, reviewerId, 'Registrado por el administrador');
        return getPayment(pay.lastInsertRowid);
    });
}

function approve(paymentId, reviewerId = null, note = null) {
    return db.tx(() => {
        const p = getPayment(paymentId);
        if (!p) throw httpError(404, 'Pago no encontrado.');
        if (!['pendiente', 'en_revision'].includes(p.status)) throw httpError(409, 'Ese pago ya fue procesado.');
        db.prepare(`UPDATE payments SET status = 'aprobado', reviewed_by = ?, admin_note = COALESCE(?, admin_note),
                    updated_at = ? WHERE id = ?`)
            .run(reviewerId, note, Date.now(), paymentId);

        if (p.subscription_id) {
            // Si el pago se aprueba tarde, el período se corre para no perder días pagados.
            const s = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(p.subscription_id);
            const today = todayStr();
            if (s && s.start_date < today) {
                const len = (Date.parse(s.end_date) - Date.parse(s.start_date)) / 86400000;
                db.prepare('UPDATE subscriptions SET start_date = ?, end_date = ? WHERE id = ?')
                    .run(today, addDays(today, len), s.id);
            }
            db.prepare(`UPDATE subscriptions SET status = 'activa' WHERE id = ?`).run(p.subscription_id);
        }
        return getPayment(paymentId);
    });
}

function close(paymentId, status, reviewerId = null, note = null) {
    return db.tx(() => {
        const p = getPayment(paymentId);
        if (!p) throw httpError(404, 'Pago no encontrado.');
        if (!['pendiente', 'en_revision'].includes(p.status)) throw httpError(409, 'Ese pago ya fue procesado.');
        db.prepare(`UPDATE payments SET status = ?, reviewed_by = ?, admin_note = COALESCE(?, admin_note),
                    updated_at = ? WHERE id = ?`)
            .run(status, reviewerId, note, Date.now(), paymentId);
        if (p.subscription_id) db.prepare(`UPDATE subscriptions SET status = 'cancelada' WHERE id = ?`).run(p.subscription_id);
        return getPayment(paymentId);
    });
}

function markInReview(paymentId, method, transferRef = null) {
    db.prepare(`UPDATE payments SET method = ?, status = 'en_revision', transfer_ref = ?, updated_at = ? WHERE id = ? AND status = 'pendiente'`)
        .run(method, transferRef, Date.now(), paymentId);
    return getPayment(paymentId);
}

/** Pagos que quedaron sin elegir método por más de 3 días se cancelan solos. */
function expireStale() {
    const limit = Date.now() - 3 * 86400000;
    const stale = db.prepare(`SELECT id FROM payments WHERE status = 'pendiente' AND created_at < ?`).all(limit);
    for (const p of stale) close(p.id, 'cancelado', null, 'Vencido sin pagar');
}

module.exports = { startPlanPurchase, approve, close, markInReview, getPayment, expireStale };
