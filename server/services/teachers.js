'use strict';
/**
 * Profes: asignación a horarios, ausencias y estado de cada clase.
 * Lo que ve el público es solo "quién da la clase" o "falta profe": nunca el motivo de la ausencia.
 */
const db = require('../db');
const { addDays, weekdayOf } = require('../lib/util');

/** Nombre corto para mostrar al público: "Ana P." */
const shortName = (t) => `${t.name} ${(t.lastname || '').charAt(0)}.`.trim();

const qAssigned = db.prepare(`SELECT u.id, u.name, u.lastname FROM slot_teachers st
                              JOIN users u ON u.id = st.teacher_id
                              WHERE st.slot_id = ? AND u.role = 'profe' AND u.active = 1
                              ORDER BY u.name, u.lastname`);
const qAbsent = db.prepare('SELECT teacher_id FROM teacher_absences WHERE slot_id = ? AND date = ?');

/**
 * Estado de los profes de un horario en una fecha.
 * state: 'sin_asignar' (el gym no cargó profe) · 'ok' · 'menos' (falta al menos uno) · 'sin_profe' (faltan todos)
 */
function slotTeacherStatus(slotId, date) {
    const assigned = qAssigned.all(slotId);
    const absentIds = new Set(qAbsent.all(slotId, date).map(r => r.teacher_id));
    const present = assigned.filter(t => !absentIds.has(t.id));
    const absent = assigned.length - present.length;
    let state = 'ok';
    if (!assigned.length) state = 'sin_asignar';
    else if (!present.length) state = 'sin_profe';
    else if (absent > 0) state = 'menos';

    let label = null;
    if (state === 'ok') label = `Profe: ${present.map(shortName).join(', ')}`;
    else if (state === 'menos') label = `${absent === 1 ? 'Falta 1 profe' : `Faltan ${absent} profes`} · da la clase ${present.map(shortName).join(', ')}`;
    else if (state === 'sin_profe') label = 'Sin profe: avisó que no viene';

    return { state, assigned: assigned.length, present: present.length, absent, names: present.map(shortName), label };
}

/** Horarios asignados a un profe (con su actividad). */
function teacherSlots(teacherId) {
    return db.prepare(`SELECT s.id, s.weekday, s.start_time, s.end_time, s.capacity, s.active,
                              a.id AS activity_id, a.name AS activity_name, a.location, a.color, a.active AS activity_active
                       FROM slot_teachers st
                       JOIN schedule_slots s ON s.id = st.slot_id
                       JOIN activities a ON a.id = s.activity_id
                       WHERE st.teacher_id = ?
                       ORDER BY s.weekday, s.start_time`).all(teacherId);
}

/** ¿Este profe da este horario? (control de acceso: un profe solo ve SUS clases) */
function teachesSlot(teacherId, slotId) {
    return !!db.prepare('SELECT 1 FROM slot_teachers WHERE teacher_id = ? AND slot_id = ?').get(teacherId, slotId);
}

const qStudents = db.prepare(`SELECT r.ticket, u.name, u.lastname
                              FROM reservations r JOIN users u ON u.id = r.user_id
                              WHERE r.slot_id = ? AND r.date = ? AND r.status = 'activa'
                              ORDER BY r.ticket`);

/** Una clase puntual (horario + fecha) vista por el profe: alumnos, cupo y estado de profes. */
function classView(slot, date, teacherId) {
    const students = qStudents.all(slot.id, date);
    const blockedDay = db.prepare('SELECT reason FROM blocked_days WHERE date = ?').get(date);
    const blockedSlot = db.prepare('SELECT reason FROM blocked_slots WHERE slot_id = ? AND date = ?').get(slot.id, date);
    const myAbsence = db.prepare('SELECT id, reason FROM teacher_absences WHERE teacher_id = ? AND slot_id = ? AND date = ?')
        .get(teacherId, slot.id, date) || null;
    const coTeachers = db.prepare(`SELECT u.id, u.name, u.lastname,
                                          EXISTS(SELECT 1 FROM teacher_absences ab WHERE ab.teacher_id = u.id AND ab.slot_id = ? AND ab.date = ?) AS absent
                                   FROM slot_teachers st JOIN users u ON u.id = st.teacher_id
                                   WHERE st.slot_id = ? AND st.teacher_id <> ? AND u.role = 'profe' AND u.active = 1`)
        .all(slot.id, date, slot.id, teacherId);
    return {
        slotId: slot.id, date,
        activity: slot.activity_name, location: slot.location, color: slot.color,
        start_time: slot.start_time, end_time: slot.end_time, capacity: slot.capacity,
        count: students.length,
        students: students.map(s => ({ ticket: s.ticket, name: `${s.name} ${s.lastname}` })),
        blocked: blockedDay?.reason || blockedSlot?.reason || null,
        myAbsence,
        coTeachers: coTeachers.map(t => ({ name: `${t.name} ${t.lastname}`, absent: !!t.absent })),
        status: slotTeacherStatus(slot.id, date),
    };
}

/** Calendario de un mes para el profe: cada día con las clases que da, cuántos y quiénes. */
function teacherCalendar(teacherId, month) {
    const slots = teacherSlots(teacherId).filter(s => s.active && s.activity_active);
    const first = `${month}-01`;
    const days = [];
    for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) {
        const wd = weekdayOf(d);
        const classes = slots.filter(s => s.weekday === wd).map(s => classView(s, d, teacherId));
        if (classes.length) days.push({ date: d, classes });
    }
    return { month, days };
}

/** Ausencias próximas de todos los profes (para el admin y el asistente). */
function upcomingAbsences(fromDate, toDate) {
    return db.prepare(`SELECT ab.id, ab.date, ab.reason, ab.created_at, ab.slot_id,
                              u.id AS teacher_id, u.name, u.lastname,
                              s.start_time, s.end_time, a.name AS activity_name, a.location
                       FROM teacher_absences ab
                       JOIN users u ON u.id = ab.teacher_id
                       JOIN schedule_slots s ON s.id = ab.slot_id
                       JOIN activities a ON a.id = s.activity_id
                       WHERE ab.date BETWEEN ? AND ?
                       ORDER BY ab.date, s.start_time`).all(fromDate, toDate);
}

module.exports = { shortName, slotTeacherStatus, teacherSlots, teachesSlot, classView, teacherCalendar, upcomingAbsences };
