'use strict';
const express = require('express');
const db = require('../db');
const { parse, v, z, httpError, notFound, audit, addDays, weekdayOf, minutesUntil, todayStr } = require('../lib/util');
const { requireUser, requireMember } = require('../security/auth');
const T = require('../services/teachers');
const B = require('../services/booking');

const router = express.Router();
router.use(requireUser);

/* ---------- Estado del usuario respecto a reservas ---------- */
router.get('/status', (req, res) => {
    const { days, settings } = B.bookingWindow();
    res.json({
        requirePlan: settings.require_plan_to_reserve === '1',
        bookingDaysAhead: days,
        cancelMinHours: parseInt(settings.cancel_min_hours, 10) || 0,
        subscriptions: B.activeSubscriptions(req.user.id),
    });
});

/* ---------- Días disponibles para una actividad ---------- */
router.get('/dates', (req, res) => {
    const { activity } = parse(z.object({ activity: v.id }), req.query);
    const act = db.prepare('SELECT id, name FROM activities WHERE id = ? AND active = 1').get(activity);
    if (!act) throw notFound('Actividad');

    const weekdays = new Set(db.prepare('SELECT DISTINCT weekday FROM schedule_slots WHERE activity_id = ? AND active = 1')
        .all(activity).map(r => r.weekday));
    const { today, days } = B.bookingWindow();
    const out = [];
    for (let i = 0; i < days; i++) {
        const date = addDays(today, i);
        const blocked = B.isDayBlocked(date);
        out.push({
            date,
            weekday: weekdayOf(date),
            hasSchedule: weekdays.has(weekdayOf(date)),
            blocked: !!blocked,
            reason: blocked?.reason || null,
            covered: B.coveringSubscriptions(req.user.id, activity, date).length > 0,
        });
    }
    res.json({ activity: act, days: out });
});

/* ---------- Horarios de una actividad en una fecha ---------- */
router.get('/slots', (req, res) => {
    const { activity, date } = parse(z.object({ activity: v.id, date: v.date }), req.query);
    const slots = db.prepare(`SELECT id, start_time, end_time, capacity FROM schedule_slots
                              WHERE activity_id = ? AND weekday = ? AND active = 1 ORDER BY start_time`)
        .all(activity, weekdayOf(date));
    const dayBlocked = !!B.isDayBlocked(date);
    res.json({
        slots: slots.map(s => {
            const blocked = dayBlocked || !!B.isSlotBlocked(s.id, date);
            const mine = db.prepare(`SELECT ticket FROM reservations WHERE slot_id = ? AND date = ? AND user_id = ? AND status = 'activa'`)
                .get(s.id, date, req.user.id);
            return {
                ...s,
                taken: B.takenCount(s.id, date),
                blocked,
                started: minutesUntil(date, s.start_time) <= 0,
                myTicket: mine?.ticket || null,
                teachers: T.slotTeacherStatus(s.id, date),
            };
        }),
    });
});

/* ---------- Boletos de un horario ---------- */
router.get('/tickets', (req, res) => {
    const { slot, date } = parse(z.object({ slot: v.id, date: v.date }), req.query);
    const s = B.slotInfo(slot);
    if (!s) throw notFound('Horario');
    const rows = db.prepare(`SELECT ticket, user_id FROM reservations WHERE slot_id = ? AND date = ? AND status = 'activa'`)
        .all(slot, date);
    const byTicket = new Map(rows.map(r => [r.ticket, r.user_id]));
    const tickets = [];
    for (let n = 1; n <= s.capacity; n++) {
        const uid = byTicket.get(n);
        // Privacidad: nunca se muestra quién ocupa un boleto ajeno.
        tickets.push({ n, status: uid === undefined ? 'free' : (uid === req.user.id ? 'mine' : 'taken') });
    }
    res.json({
        slot: { id: s.id, activity_id: s.activity_id, activity_name: s.activity_name, start_time: s.start_time, end_time: s.end_time, capacity: s.capacity },
        tickets,
    });
});

/* ---------- Crear reserva ---------- */
router.post('/', requireMember, (req, res) => {
    const body = parse(z.object({ slotId: v.id, date: v.date, ticket: z.coerce.number().int().min(1).max(100) }), req.body);
    let r;
    try {
        r = B.createReservation(req.user.id, body.slotId, body.date, body.ticket);
    } catch (e) {
        // Si dos personas tocan el mismo boleto a la vez, el índice único de la base frena a la segunda.
        if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') throw httpError(409, 'Ese boleto acaba de ser tomado. Elegí otro.', { refresh: true });
        throw e;
    }
    audit(req, 'reserva.crear', `#${r.id} ${r.activity_name} ${r.date} ${r.start_time} boleto ${r.ticket}`);
    res.status(201).json({ reservation: r });
});

/* ---------- Mis reservas ---------- */
router.get('/mine', (req, res) => {
    const list = db.prepare(`SELECT r.id, r.activity_id, r.activity_name, r.date, r.start_time, r.end_time, r.ticket, r.status,
                                    r.cancel_reason, a.color
                             FROM reservations r LEFT JOIN activities a ON a.id = r.activity_id
                             WHERE r.user_id = ? AND r.hidden = 0
                             ORDER BY r.date DESC, r.start_time DESC LIMIT 300`).all(req.user.id);
    res.json({ reservations: list, today: todayStr() });
});

/* ---------- Cancelar una reserva futura ---------- */
router.post('/:id/cancel', (req, res) => {
    const { id } = parse(z.object({ id: v.id }), req.params);
    const r = db.prepare('SELECT * FROM reservations WHERE id = ? AND user_id = ?').get(id, req.user.id); // solo las propias
    if (!r) throw notFound('Reserva');
    if (r.status !== 'activa') throw httpError(400, 'Esa reserva ya estaba cancelada.');
    const { settings } = B.bookingWindow();
    const minH = parseInt(settings.cancel_min_hours, 10) || 0;
    if (minutesUntil(r.date, r.start_time) < minH * 60) {
        throw httpError(400, minH ? `Solo podés cancelar hasta ${minH} h antes de la clase.` : 'Esa clase ya empezó.');
    }
    B.cancelReservation(r.id, 'Cancelada por el usuario');
    audit(req, 'reserva.cancelar', `#${r.id}`);
    res.json({ ok: true });
});

/* ---------- Ocultar reservas pasadas del listado ---------- */
router.post('/hide-past', (req, res) => {
    const info = db.prepare(`UPDATE reservations SET hidden = 1
                             WHERE user_id = ? AND (date < ? OR status = 'cancelada')`).run(req.user.id, todayStr());
    res.json({ ok: true, hidden: info.changes });
});

module.exports = router;
