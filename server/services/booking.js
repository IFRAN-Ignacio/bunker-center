'use strict';
/** Reglas de negocio de reservas: validadas SIEMPRE en el servidor. */
const db = require('../db');
const { httpError, todayStr, addDays, weekdayOf, weekStart, minutesUntil, getSettings } = require('../lib/util');

function bookingWindow() {
    const s = getSettings();
    const days = Math.min(Math.max(parseInt(s.booking_days_ahead, 10) || 14, 1), 60);
    const today = todayStr();
    return { today, last: addDays(today, days - 1), days, settings: s };
}

/** Suscripciones activas del usuario que cubren esa actividad en esa fecha. */
function coveringSubscriptions(userId, activityId, date) {
    return db.prepare(`SELECT * FROM subscriptions
                       WHERE user_id = ? AND status = 'activa' AND start_date <= ? AND end_date >= ?
                         AND (kind = 'membresia' OR activity_id = ?)`).all(userId, date, date, activityId);
}

/** Lista de actividades que el usuario tiene cubiertas hoy (para mostrar en el front). */
function activeSubscriptions(userId) {
    const today = todayStr();
    return db.prepare(`SELECT s.id, s.plan_name, s.kind, s.activity_id, a.name AS activity_name, s.weekly_limit,
                              s.start_date, s.end_date, s.status
                       FROM subscriptions s LEFT JOIN activities a ON a.id = s.activity_id
                       WHERE s.user_id = ? AND s.status = 'activa' AND s.end_date >= ?
                       ORDER BY s.start_date`).all(userId, today);
}

function slotInfo(slotId) {
    // El nombre incluye la sede/sala (si tiene) para que quede en el historial de la reserva.
    return db.prepare(`SELECT s.*, a.name || CASE WHEN a.location <> '' THEN ' · ' || a.location ELSE '' END AS activity_name,
                              a.active AS activity_active
                       FROM schedule_slots s JOIN activities a ON a.id = s.activity_id WHERE s.id = ?`).get(slotId);
}

function isDayBlocked(date) {
    return db.prepare('SELECT reason FROM blocked_days WHERE date = ?').get(date);
}
function isSlotBlocked(slotId, date) {
    return db.prepare('SELECT reason FROM blocked_slots WHERE slot_id = ? AND date = ?').get(slotId, date);
}
function takenCount(slotId, date) {
    return db.prepare(`SELECT COUNT(*) c FROM reservations WHERE slot_id = ? AND date = ? AND status = 'activa'`)
        .get(slotId, date).c;
}

/**
 * Verifica todo lo necesario para reservar y lanza un error claro si algo falla.
 * Se ejecuta dentro de una transacción junto con el INSERT para evitar carreras.
 */
function assertCanBook(userId, slotId, date, ticket) {
    const { today, last, settings } = bookingWindow();
    const slot = slotInfo(slotId);
    if (!slot || !slot.active || !slot.activity_active) throw httpError(404, 'Ese horario no existe.');
    if (weekdayOf(date) !== slot.weekday) throw httpError(400, 'Ese horario no se dicta ese día.');
    if (date < today) throw httpError(400, 'No podés reservar en una fecha pasada.');
    if (date > last) throw httpError(400, 'Todavía no se puede reservar para esa fecha.');
    if (minutesUntil(date, slot.start_time) <= 0) throw httpError(400, 'Esa clase ya empezó.');
    if (ticket < 1 || ticket > slot.capacity) throw httpError(400, 'Boleto inválido.');

    const bd = isDayBlocked(date);
    if (bd) throw httpError(409, `Ese día no hay clases: ${bd.reason}.`);
    const bs = isSlotBlocked(slotId, date);
    if (bs) throw httpError(409, `Ese horario no está disponible: ${bs.reason}.`);

    if (settings.require_plan_to_reserve === '1') {
        const subs = coveringSubscriptions(userId, slot.activity_id, date);
        if (!subs.length) {
            throw httpError(402, `Necesitás un plan activo que incluya ${slot.activity_name} para esa fecha.`, { needsPlan: true });
        }
        // Límite semanal: si TODOS los planes que cubren tienen tope, se usa el mayor.
        if (subs.every(s => s.weekly_limit)) {
            const limit = Math.max(...subs.map(s => s.weekly_limit));
            const ws = weekStart(date);
            const used = db.prepare(`SELECT COUNT(*) c FROM reservations
                                     WHERE user_id = ? AND status = 'activa' AND date BETWEEN ? AND ?`)
                .get(userId, ws, addDays(ws, 6)).c;
            if (used >= limit) throw httpError(409, `Tu plan permite ${limit} clase(s) por semana y ya las reservaste.`);
        }
    }

    const dup = db.prepare(`SELECT 1 FROM reservations WHERE user_id = ? AND slot_id = ? AND date = ? AND status = 'activa'`)
        .get(userId, slotId, date);
    if (dup) throw httpError(409, 'Ya tenés una reserva en esa clase.');

    const taken = db.prepare(`SELECT 1 FROM reservations WHERE slot_id = ? AND date = ? AND ticket = ? AND status = 'activa'`)
        .get(slotId, date, ticket);
    if (taken) throw httpError(409, 'Ese boleto acaba de ser tomado. Elegí otro.', { refresh: true });

    return slot;
}

function createReservation(userId, slotId, date, ticket) {
    return db.tx(() => {
        const slot = assertCanBook(userId, slotId, date, ticket);
        const info = db.prepare(`INSERT INTO reservations
            (user_id, slot_id, activity_id, activity_name, date, start_time, end_time, ticket, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'activa', ?)`)
            .run(userId, slot.id, slot.activity_id, slot.activity_name, date, slot.start_time, slot.end_time, ticket, Date.now());
        return db.prepare('SELECT * FROM reservations WHERE id = ?').get(info.lastInsertRowid);
    });
}

function cancelReservation(resId, reason) {
    db.prepare(`UPDATE reservations SET status = 'cancelada', cancel_reason = ?, cancelled_at = ? WHERE id = ? AND status = 'activa'`)
        .run(reason, Date.now(), resId);
}

module.exports = {
    bookingWindow, coveringSubscriptions, activeSubscriptions, slotInfo, isDayBlocked, isSlotBlocked,
    takenCount, createReservation, cancelReservation,
};
