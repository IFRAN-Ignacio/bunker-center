'use strict';
const db = require('../db');

/** Datos del calendario mensual de un usuario: clases reservadas, planes vigentes y días cerrados. */
function userCalendar(userId, month) {
    const from = `${month}-01`;
    const to = `${month}-31`;
    return {
        month,
        reservations: db.prepare(`SELECT r.id, r.activity_name, r.date, r.start_time, r.end_time, r.ticket, r.status, a.color
                                  FROM reservations r LEFT JOIN activities a ON a.id = r.activity_id
                                  WHERE r.user_id = ? AND r.date BETWEEN ? AND ? AND r.status = 'activa'
                                  ORDER BY r.date, r.start_time`).all(userId, from, to),
        subscriptions: db.prepare(`SELECT s.plan_name, s.start_date, s.end_date
                                   FROM subscriptions s WHERE s.user_id = ? AND s.status = 'activa'
                                     AND s.start_date <= ? AND s.end_date >= ?`).all(userId, to, from),
        blockedDays: db.prepare('SELECT date, reason FROM blocked_days WHERE date BETWEEN ? AND ?').all(from, to),
    };
}

module.exports = { userCalendar };
