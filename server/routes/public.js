'use strict';
/** Datos públicos del sitio (no requieren sesión). Solo se exponen campos pensados para mostrarse. */
const express = require('express');
const db = require('../db');
const { getSettings, PUBLIC_SETTINGS, todayStr } = require('../lib/util');

const router = express.Router();

function publicActivities() {
    const acts = db.prepare(`SELECT id, slug, name, short_name, description, color, icon, location
                             FROM activities WHERE active = 1 ORDER BY sort_order, id`).all();
    const slots = db.prepare(`SELECT s.id, s.activity_id, s.weekday, s.start_time, s.end_time, s.capacity
                              FROM schedule_slots s JOIN activities a ON a.id = s.activity_id
                              WHERE s.active = 1 AND a.active = 1
                              ORDER BY s.weekday, s.start_time`).all();
    return acts.map(a => ({ ...a, slots: slots.filter(s => s.activity_id === a.id) }));
}

router.get('/site', (req, res) => {
    const all = getSettings();
    const settings = Object.fromEntries(PUBLIC_SETTINGS.map(k => [k, all[k]]));
    const today = todayStr();

    res.set('Cache-Control', 'no-store');
    res.json({
        settings,
        openingHours: db.prepare('SELECT weekday, is_open, open_time, close_time FROM opening_hours ORDER BY weekday').all(),
        activities: publicActivities(),
        plans: db.prepare(`SELECT p.id, p.name, p.description, p.kind, p.activity_id, a.name AS activity_name,
                                  p.price, p.duration_days, p.weekly_limit, p.featured, p.promo_until
                           FROM plans p LEFT JOIN activities a ON a.id = p.activity_id
                           WHERE p.active = 1 AND (p.activity_id IS NULL OR a.active = 1)
                             AND (p.promo_until IS NULL OR p.promo_until >= ?)   -- una promo vencida se oculta sola
                           ORDER BY p.sort_order, p.price`).all(today),
        // Los avisos con botón de promo se ocultan solos cuando su plan deja de estar en promo.
        notifications: db.prepare(`SELECT n.id, n.message, n.type, n.created_at, n.plan_id FROM notifications n
                                   LEFT JOIN plans p ON p.id = n.plan_id
                                   WHERE n.active = 1 AND (n.plan_id IS NULL OR (p.active = 1 AND p.promo_until >= ?))
                                   ORDER BY n.created_at DESC LIMIT 5`).all(today),
        blockedDays: db.prepare('SELECT date, reason FROM blocked_days WHERE date >= ? ORDER BY date LIMIT 30').all(today),
    });
});

router.get('/products', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
        products: db.prepare(`SELECT id, name, description, category, price, available, image
                              FROM products WHERE active = 1 ORDER BY category, sort_order, name`).all(),
    });
});

module.exports = router;
module.exports.publicActivities = publicActivities;
