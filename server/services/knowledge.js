'use strict';
/**
 * CONOCIMIENTO DEL ASISTENTE
 *
 * El bot NUNCA lee la base de datos. Lee solo dos archivos CSV de la carpeta knowledge/:
 *
 *  1. conocimiento_publico.csv  → se GENERA solo, a partir de la base, con datos que ya son públicos
 *     en la página (horarios, actividades, precios, productos, reglas, avisos, profes que faltan).
 *     Se regenera cada vez que el admin o un profe cambia algo, al arrancar y cada hora,
 *     así está siempre igual que la página. Nunca incluye usuarios, correos, reservas, pagos ni hashes.
 *
 *  2. extras_gym.csv  → conocimiento "obvio de gym" que no está en ninguna pantalla
 *     (traer toalla y botella, llegar antes, etc.). Lo edita el admin desde la pestaña Asistente.
 *
 * Ninguno de los dos se publica por web: la carpeta knowledge/ no está en la lista de carpetas estáticas.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../db');
const { getSettings, todayStr, addDays, weekdayOf } = require('../lib/util');
const T = require('./teachers');
const DATA = require('../seed-data');

const DIR = config.knowledgeDir;
const PUBLIC_FILE = path.join(DIR, 'conocimiento_publico.csv');
const EXTRAS_FILE = path.join(DIR, 'extras_gym.csv');
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAYS_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
// Preguntas que venían de fábrica en el viejo FAQ: ya están cubiertas por los extras, no se duplican.
const OLD_DEFAULT_FAQS = new Set(['¿Necesito experiencia previa para empezar?', '¿Cómo reservo una clase?', '¿Puedo cancelar una reserva?',
    '¿Qué medios de pago aceptan?', '¿Puedo hacer una clase de prueba?', '¿Qué tengo que llevar?', '¿Hay vestuarios?']);
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/* =========================================================
   CSV (escritura y lectura) — RFC 4180
   ========================================================= */
// Defensa contra "inyección CSV": si alguien abre el archivo en Excel, un valor que empieza con
// = + - @ podría ejecutarse como fórmula. Se le antepone un apóstrofo para que sea texto.
function csvCell(value) {
    let s = String(value ?? '').replace(/\r\n?/g, '\n');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (header, rows) => [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n';

function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); rows.push(row); row = []; cell = '';
        } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
}
const unFormula = (s) => (/^'[=+\-@]/.test(s) ? s.slice(1) : s);

function writeAtomic(file, content) {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, '﻿' + content, 'utf8'); // BOM: Excel lo abre con tildes bien
    fs.renameSync(tmp, file);
}

/* =========================================================
   1) CONOCIMIENTO PÚBLICO (autogenerado desde la base)
   ========================================================= */
const money = (n) => '$' + Number(n).toLocaleString('es-AR');
const dmy = (d) => d.split('-').reverse().slice(0, 2).join('/');

function buildPublicRows() {
    const s = getSettings();
    const rows = [];
    const add = (categoria, tema, dato) => rows.push([categoria, tema, dato]);
    const today = todayStr();

    add('gimnasio', 'Nombre', `${DATA.site.name} Center (Crossfit & Training), Mar del Plata`);
    add('gimnasio', 'Dirección', s.address);
    add('gimnasio', 'Teléfono', s.phone);
    if (s.whatsapp) add('gimnasio', 'WhatsApp', `${s.whatsapp} (https://wa.me/${s.whatsapp})`);
    if (s.instagram) add('gimnasio', 'Instagram', `${s.instagram} (https://instagram.com/${s.instagram})`);
    if (s.facebook_url) add('gimnasio', 'Facebook', s.facebook_url);
    if (s.contact_email) add('gimnasio', 'Correo de contacto', s.contact_email);
    if (s.schedule_note) add('gimnasio', 'Nota sobre horarios', s.schedule_note);

    for (const h of db.prepare('SELECT * FROM opening_hours ORDER BY weekday').all().sort((a, b) => WEEK.indexOf(a.weekday) - WEEK.indexOf(b.weekday))) {
        add('horario del gimnasio', DAYS[h.weekday], h.is_open ? `abierto de ${h.open_time} a ${h.close_time}` : 'cerrado');
    }

    const acts = db.prepare('SELECT * FROM activities WHERE active = 1 ORDER BY sort_order, id').all();
    for (const a of acts) {
        add('actividad', a.name, a.description + (a.location ? ` Lugar: ${a.location}.` : ''));
        const slots = db.prepare('SELECT * FROM schedule_slots WHERE activity_id = ? AND active = 1 ORDER BY start_time').all(a.id);
        for (const wd of WEEK) {
            const list = slots.filter(x => x.weekday === wd);
            if (!list.length) continue;
            const txt = list.map(x => {
                const st = T.slotTeacherStatus(x.id, '0000-00-00'); // sin fecha: solo quiénes están asignados
                return `${x.start_time} a ${x.end_time} (cupo ${x.capacity}${st.assigned ? `, profe ${st.names.join(' y ')}` : ''})`;
            }).join('; ');
            add('horarios de clases', `${a.name} los ${DAYS_PLURAL[wd]}`, txt);
        }
    }

    const plans = db.prepare(`SELECT p.*, a.name AS activity_name FROM plans p LEFT JOIN activities a ON a.id = p.activity_id
                              WHERE p.active = 1 AND (p.promo_until IS NULL OR p.promo_until >= ?)
                              ORDER BY p.sort_order, p.price`).all(today);
    for (const p of plans) {
        const parts = [`${money(p.price)} por ${p.duration_days === 1 ? '1 día' : p.duration_days + ' días'}`];
        parts.push(p.kind === 'actividad' ? `solo ${p.activity_name}` : 'cualquier clase');
        parts.push(p.weekly_limit ? `hasta ${p.weekly_limit} clase(s) por semana` : 'sin límite semanal');
        if (p.featured) parts.push('plan destacado');
        if (p.promo_until) parts.push(`PROMO válida hasta el ${dmy(p.promo_until)}`);
        add('plan y precio', p.name, `${parts.join(', ')}. ${p.description}`.trim());
    }

    const prods = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY category, sort_order, name').all();
    for (const p of prods) {
        add('producto del mostrador', p.name, `${money(p.price)} · ${p.category} · ${p.available ? 'hay stock' : 'sin stock por ahora'}. ${p.description}`.trim());
    }
    if (prods.length) add('producto del mostrador', 'Cómo se compran', 'Los productos se compran en el mostrador del gimnasio. La página solo muestra precios; no hay compra online.');

    const days = Math.min(Math.max(parseInt(s.booking_days_ahead, 10) || 14, 1), 60);
    add('reglas', 'Anticipación para reservar', `Se puede reservar con hasta ${days} días de anticipación.`);
    add('reglas', 'Cancelación', Number(s.cancel_min_hours) > 0
        ? `Se cancela desde "Mis reservas" hasta ${s.cancel_min_hours} h antes de la clase.` : 'Se puede cancelar hasta que empieza la clase.');
    add('reglas', 'Plan para reservar', s.require_plan_to_reserve === '1'
        ? 'Para reservar hace falta un plan activo que incluya esa actividad.' : 'Se puede reservar sin plan activo.');
    add('reglas', 'Boleto', 'Al reservar se elige un boleto: es tu lugar numerado en la clase. Cada clase tiene un cupo máximo.');
    add('pagos', 'Medios de pago', 'Transferencia bancaria (desde la página ves alias, CBU y titular, y después informás el número de operación) o efectivo en la recepción. En los dos casos el pago queda en revisión hasta que el administrador lo confirma. No se aceptan tarjetas.');
    add('pagos', 'Datos para transferir', `Alias ${s.transfer_alias} · CBU/CVU ${s.transfer_cbu} · titular ${s.transfer_holder}.`);
    add('pagos', 'Aprobación', 'Los pagos por transferencia o efectivo los aprueba el gimnasio; el plan se activa cuando el pago queda aprobado. Un pago iniciado y no pagado se cancela solo a los 3 días.');
    add('cuenta', 'Crear cuenta', 'Desde "Ingresar" → "Crear cuenta" con nombre, apellido, correo y una contraseña de al menos 8 caracteres con letras y números.');
    add('cuenta', 'Olvidé mi contraseña', 'Por ahora se resuelve en la recepción del gimnasio o por WhatsApp.');

    for (const n of db.prepare(`SELECT n.message FROM notifications n LEFT JOIN plans p ON p.id = n.plan_id
                                WHERE n.active = 1 AND (n.plan_id IS NULL OR (p.active = 1 AND p.promo_until >= ?))
                                ORDER BY n.created_at DESC LIMIT 5`).all(today)) {
        add('aviso vigente', 'Aviso del gimnasio', n.message);
    }
    for (const b of db.prepare('SELECT date, reason FROM blocked_days WHERE date BETWEEN ? AND ? ORDER BY date').all(today, addDays(today, 30))) {
        add('días sin clases', `${DAYS[weekdayOf(b.date)]} ${dmy(b.date)}`, `No hay clases: ${b.reason}.`);
    }
    for (const b of db.prepare(`SELECT b.date, b.reason, s.start_time, a.name FROM blocked_slots b
                                JOIN schedule_slots s ON s.id = b.slot_id JOIN activities a ON a.id = s.activity_id
                                WHERE b.date BETWEEN ? AND ? ORDER BY b.date, s.start_time`).all(today, addDays(today, 30))) {
        add('clases suspendidas', `${b.name} ${dmy(b.date)} ${b.start_time}`, `Suspendida: ${b.reason}.`);
    }
    // Profes que avisaron que faltan (solo el estado, nunca el motivo)
    const seen = new Set();
    for (const ab of T.upcomingAbsences(today, addDays(today, 14))) {
        const key = ab.slot_id + ab.date;
        if (seen.has(key)) continue;
        seen.add(key);
        const st = T.slotTeacherStatus(ab.slot_id, ab.date);
        add('profes', `${ab.activity_name} ${DAYS[weekdayOf(ab.date)]} ${dmy(ab.date)} ${ab.start_time}`, st.label || 'Cambio de profe');
    }
    add('sistema', 'Datos actualizados', `${today} ${new Date().toLocaleTimeString('es-AR', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`);
    return rows;
}

function exportPublic() {
    writeAtomic(PUBLIC_FILE, toCsv(['categoria', 'tema', 'dato'], buildPublicRows()));
    cache.publicMtime = 0;
}

let timer = null;
/** Se llama después de cada cambio: agrupa varios cambios seguidos en una sola exportación. */
function scheduleExport() {
    clearTimeout(timer);
    timer = setTimeout(() => { try { exportPublic(); } catch (e) { console.error('No se pudo exportar el conocimiento:', e.message); } }, 200);
    timer.unref?.();
}

/* =========================================================
   2) EXTRAS (editables por el admin)
   ========================================================= */
function readExtras() {
    if (!fs.existsSync(EXTRAS_FILE)) return [];
    return parseCsv(fs.readFileSync(EXTRAS_FILE, 'utf8')).slice(1)
        .map((r, i) => ({ id: i + 1, tema: unFormula(r[0] || '').trim(), dato: unFormula(r[1] || '').trim() }))
        .filter(x => x.tema && x.dato);
}
function writeExtras(list) {
    writeAtomic(EXTRAS_FILE, toCsv(['tema', 'dato'], list.map(x => [x.tema, x.dato])));
    cache.extrasMtime = 0;
}

/* =========================================================
   Lectura para el asistente (con caché por fecha de archivo)
   ========================================================= */
const cache = { publicMtime: 0, extrasMtime: 0, publicRows: [], extras: [] };
function loadKnowledge() {
    try {
        const m = fs.statSync(PUBLIC_FILE).mtimeMs;
        if (m !== cache.publicMtime) {
            cache.publicRows = parseCsv(fs.readFileSync(PUBLIC_FILE, 'utf8')).slice(1).map(r => ({ categoria: r[0], tema: unFormula(r[1] || ''), dato: unFormula(r[2] || '') }));
            cache.publicMtime = m;
        }
    } catch { cache.publicRows = []; }
    try {
        const m = fs.statSync(EXTRAS_FILE).mtimeMs;
        if (m !== cache.extrasMtime) { cache.extras = readExtras(); cache.extrasMtime = m; }
    } catch { cache.extras = []; }
    return { publicRows: cache.publicRows, extras: cache.extras };
}

/* =========================================================
   Arranque: crea los archivos y migra el viejo FAQ
   ========================================================= */
function init() {
    fs.mkdirSync(DIR, { recursive: true });
    const hasFaqTable = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='faqs'`).get();
    if (!fs.existsSync(EXTRAS_FILE)) {
        const list = DATA.extras.map(([tema, dato]) => ({ tema, dato }));
        if (hasFaqTable) {
            // Las preguntas que el admin había cargado en el FAQ pasan al conocimiento del asistente.
            for (const f of db.prepare('SELECT question, answer FROM faqs WHERE active = 1 ORDER BY sort_order, id').all()) {
                if (!OLD_DEFAULT_FAQS.has(f.question) && !list.some(x => x.dato === f.answer)) list.push({ tema: f.question, dato: f.answer });
            }
        }
        writeExtras(list);
    }
    if (hasFaqTable) db.exec('DROP TABLE faqs'); // el FAQ fue reemplazado por el asistente
    exportPublic();
}

module.exports = {
    DIR, PUBLIC_FILE, EXTRAS_FILE,
    init, exportPublic, scheduleExport, buildPublicRows,
    readExtras, writeExtras, loadKnowledge, parseCsv, toCsv, csvCell,
};
