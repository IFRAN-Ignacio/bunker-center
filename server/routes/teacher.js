'use strict';
/**
 * API de profes. Todas las rutas exigen sesión con rol 'profe' (leído de la base).
 * Un profe solo puede ver y marcar las clases que tiene ASIGNADAS: cada consulta se filtra por su id.
 */
const express = require('express');
const db = require('../db');
const { parse, v, z, httpError, notFound, audit, todayStr, addDays, weekdayOf, minutesUntil } = require('../lib/util');
const { requireTeacher } = require('../security/auth');
const T = require('../services/teachers');
const knowledge = require('../services/knowledge');

const router = express.Router();
router.use(requireTeacher);

const MAX_DAYS_AHEAD = 60;
const monthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido.') });

/* ---------- Mis horarios fijos ---------- */
router.get('/me', (req, res) => {
    res.json({ slots: T.teacherSlots(req.user.id) });
});

/* ---------- Calendario del mes: clases, cantidad y alumnos ---------- */
router.get('/calendar', (req, res) => {
    const { month } = parse(monthSchema, req.query);
    res.json(T.teacherCalendar(req.user.id, month));
});

/* ---------- Una clase puntual ---------- */
router.get('/class', (req, res) => {
    const { slot, date } = parse(z.object({ slot: v.id, date: v.date }), req.query);
    const s = T.teacherSlots(req.user.id).find(x => x.id === slot);
    if (!s || weekdayOf(date) !== s.weekday) throw notFound('Clase'); // no es suya → como si no existiera
    res.json({ class: T.classView(s, date, req.user.id) });
});

/* ---------- Avisar que falto a una clase ---------- */
router.post('/absences', (req, res) => {
    const d = parse(z.object({
        slotId: v.id,
        date: v.date,
        reason: v.text(3, 120, 'El motivo'),
    }), req.body);
    const s = T.teacherSlots(req.user.id).find(x => x.id === d.slotId);
    if (!s) throw notFound('Clase');
    if (weekdayOf(d.date) !== s.weekday) throw httpError(400, 'Ese horario no se dicta ese día.');
    const today = todayStr();
    if (d.date < today || minutesUntil(d.date, s.start_time) <= 0) throw httpError(400, 'Esa clase ya empezó o ya pasó.');
    if (d.date > addDays(today, MAX_DAYS_AHEAD)) throw httpError(400, `Solo podés avisar con hasta ${MAX_DAYS_AHEAD} días de anticipación.`);
    try {
        db.prepare('INSERT INTO teacher_absences (teacher_id, slot_id, date, reason, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(req.user.id, d.slotId, d.date, d.reason, Date.now());
    } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') throw httpError(409, 'Ya avisaste que faltás a esa clase.');
        throw e;
    }
    audit(req, 'profe.ausencia_marcar', `slot #${d.slotId} ${d.date}`);
    knowledge.scheduleExport();
    res.status(201).json({ class: T.classView(s, d.date, req.user.id) });
});

/* ---------- Retirar el aviso (vuelvo a dar la clase) ---------- */
router.delete('/absences/:id', (req, res) => {
    const { id } = parse(z.object({ id: v.id }), req.params);
    const ab = db.prepare('SELECT * FROM teacher_absences WHERE id = ? AND teacher_id = ?').get(id, req.user.id); // solo las propias
    if (!ab) throw notFound('Aviso');
    if (ab.date < todayStr()) throw httpError(400, 'No se pueden cambiar avisos de clases pasadas.');
    db.prepare('DELETE FROM teacher_absences WHERE id = ?').run(id);
    audit(req, 'profe.ausencia_retirar', `slot #${ab.slot_id} ${ab.date}`);
    knowledge.scheduleExport();
    res.json({ ok: true });
});

module.exports = router;
