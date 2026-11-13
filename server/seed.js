'use strict';
/**
 * Carga inicial de la base: actividades y horarios reales del box, planes de ejemplo,
 * productos del mostrador, el conocimiento extra del asistente y el usuario administrador (desde .env).
 *
 *   npm run seed            → crea lo que falte (no pisa datos existentes)
 *   npm run seed -- --reset → BORRA la base y la vuelve a crear desde cero
 */
const fs = require('fs');
const config = require('./config');

if (process.argv.includes('--reset')) {
    for (const f of [config.dbFile, config.dbFile + '-wal', config.dbFile + '-shm']) fs.rmSync(f, { force: true });
    // El conocimiento del asistente también vuelve a los valores de fábrica.
    fs.rmSync(config.knowledgeDir, { recursive: true, force: true });
    console.log('Base de datos borrada.');
}

const db = require('./db');
const pw = require('./security/passwords');
const P = require('./services/payments');
const DATA = require('./seed-data');

const empty = (table) => db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c === 0;

function seedContent() {
    /* ---------- Configuración ---------- */
    const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, val] of Object.entries(DATA.settings)) insSetting.run(k, String(val));

    /* ---------- Horario de apertura ---------- */
    if (empty('opening_hours')) {
        const ins = db.prepare('INSERT INTO opening_hours (weekday, is_open, open_time, close_time) VALUES (?, ?, ?, ?)');
        for (let d = 0; d <= 6; d++) {
            const h = DATA.openingHours[d];
            ins.run(d, h ? 1 : 0, h ? h[0] : null, h ? h[1] : null);
        }
    }

    /* ---------- Actividades y horarios ---------- */
    if (empty('activities')) {
        const insA = db.prepare(`INSERT INTO activities (slug, name, short_name, description, color, icon, location, sort_order)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        const insS = db.prepare(`INSERT INTO schedule_slots (activity_id, weekday, start_time, end_time, capacity) VALUES (?, ?, ?, ?, ?)`);
        DATA.activities.forEach((a, i) => {
            const id = insA.run(a.slug, a.name, a.short_name, a.description, a.color, a.icon, a.location || '', i).lastInsertRowid;
            for (const [wd, ranges] of Object.entries(a.schedule)) {
                for (const r of ranges) {
                    const [range, cap] = r.split('@');
                    const [from, to] = range.split('-');
                    insS.run(id, Number(wd), from, to, cap ? Number(cap) : a.capacity);
                }
            }
        });
    }

    /* ---------- Planes (precios de EJEMPLO, se editan desde el panel) ---------- */
    if (empty('plans')) {
        const ins = db.prepare(`INSERT INTO plans (name, description, kind, activity_id, price, duration_days, weekly_limit, featured, sort_order)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        DATA.plans.forEach((p, i) => {
            const actId = p.activity ? db.prepare('SELECT id FROM activities WHERE slug = ?').get(p.activity)?.id : null;
            if (p.kind === 'actividad' && !actId) return;
            ins.run(p.name, p.description, p.kind, actId, p.price, p.duration_days || 30, p.weekly_limit || null, p.featured ? 1 : 0, i + 1);
        });
    }

    /* ---------- Mostrador de productos ---------- */
    if (empty('products')) {
        const now = Date.now();
        const ins = db.prepare(`INSERT INTO products (name, description, category, price, available, sort_order, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        DATA.products.forEach((p, i) => ins.run(...p, i, now, now));
    }

}

async function seedUsers() {
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || '';
    const code = (process.env.ADMIN_CODE || '').trim();
    if (!email || !password || !/^\d{9}$/.test(code)) {
        console.error('✖ Faltan ADMIN_EMAIL, ADMIN_PASSWORD o ADMIN_CODE (9 dígitos) en el archivo .env');
        process.exitCode = 1;
        return;
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        console.warn('⚠ La contraseña del admin es débil. Para producción usá al menos 8 caracteres con letras y números.');
    }
    const passHash = await pw.hash(password);
    const codeHash = await pw.hash(code);
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
        db.prepare(`UPDATE users SET role='admin', password_hash=?, admin_code_hash=?, active=1, failed_logins=0, locked_until=NULL WHERE id=?`)
            .run(passHash, codeHash, existing.id);
        console.log(`✔ Admin actualizado: ${email}`);
    } else {
        db.prepare(`INSERT INTO users (name, lastname, email, password_hash, role, admin_code_hash, created_at)
                    VALUES (?, ?, ?, ?, 'admin', ?, ?)`)
            .run(process.env.ADMIN_NAME || 'Admin', DATA.site.name, email, passHash, codeHash, Date.now());
        console.log(`✔ Admin creado: ${email}`);
    }

    const demoEmail = `demo@${DATA.site.id}.com`;
    if (process.env.SEED_DEMO === 'true' && !db.prepare('SELECT 1 FROM users WHERE email = ?').get(demoEmail)) {
        const id = db.prepare(`INSERT INTO users (name, lastname, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
            .run('Socio', 'Demo', demoEmail, await pw.hash('Demo1234'), Date.now()).lastInsertRowid;
        const plan = db.prepare('SELECT * FROM plans WHERE name = ?').get(DATA.demoPlan);
        if (plan) P.startPlanPurchase(id, plan, { method: 'efectivo', status: 'aprobado' });
        console.log(`✔ Usuario demo: ${demoEmail} / Demo1234 (con ${DATA.demoPlan} activo)`);
    }

    // Profes de prueba: Crossfit tiene 2 profes por clase (así se ve "falta 1 profe"), el resto 1.
    if (process.env.SEED_DEMO === 'true') {
        const demoTeachers = [
            { email: `profe@${DATA.site.id}.com`, name: 'Martina', lastname: 'Rossi', acts: ['crossfit'] },
            { email: `profe2@${DATA.site.id}.com`, name: 'Lucas', lastname: 'Pereyra', acts: ['crossfit', 'hibrido'] },
        ];
        const assign = db.prepare('INSERT OR IGNORE INTO slot_teachers (slot_id, teacher_id, created_at) VALUES (?, ?, ?)');
        for (const t of demoTeachers) {
            if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(t.email)) continue;
            const id = db.prepare(`INSERT INTO users (name, lastname, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'profe', ?)`)
                .run(t.name, t.lastname, t.email, await pw.hash('Profe1234'), Date.now()).lastInsertRowid;
            const slots = db.prepare(`SELECT s.id FROM schedule_slots s JOIN activities a ON a.id = s.activity_id
                                      WHERE a.slug IN (${t.acts.map(() => '?').join(',')})`).all(...t.acts);
            db.tx(() => slots.forEach(sl => assign.run(sl.id, id, Date.now())));
            console.log(`✔ Profe demo: ${t.email} / Profe1234 (${slots.length} horarios)`);
        }
        // El socio demo queda anotado en las próximas 2 clases de Crossfit (así los profes ven alumnos).
        const demo = db.prepare('SELECT id FROM users WHERE email = ?').get(demoEmail);
        if (demo && !db.prepare('SELECT 1 FROM reservations WHERE user_id = ?').get(demo.id)) {
            const B = require('./services/booking');
            const { todayStr, addDays, weekdayOf } = require('./lib/util');
            let booked = 0;
            for (let i = 1; i <= 7 && booked < 2; i++) {
                const date = addDays(todayStr(), i);
                const slot = db.prepare(`SELECT s.id FROM schedule_slots s JOIN activities a ON a.id = s.activity_id
                                         WHERE a.slug = 'crossfit' AND s.weekday = ? ORDER BY s.start_time DESC LIMIT 1`).get(weekdayOf(date));
                if (!slot) continue;
                try { B.createReservation(demo.id, slot.id, date, 4 + booked); booked++; } catch (e) { }
            }
            if (booked) console.log(`✔ Socio demo anotado en ${booked} clase(s) de Crossfit`);
        }
    }
}

(async () => {
    db.tx(seedContent);
    require('./services/knowledge').init();
    console.log('✔ Contenido inicial cargado (actividades, horarios, planes, productos y conocimiento del asistente).');
    await seedUsers();
    db.close();
})();
