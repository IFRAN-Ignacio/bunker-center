'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');   // mejor concurrencia lectura/escritura
db.pragma('foreign_keys = ON');    // integridad referencial
db.pragma('busy_timeout = 5000');

const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

/* =========================================================
   Migraciones: cambios hechos después de la primera versión.
   Se aplican solas al arrancar y NO borran datos.
   ========================================================= */
const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
const tableSql = (name) => db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)?.sql || '';

// v2: la tabla users acepta el rol 'profe'. SQLite no permite cambiar un CHECK,
// así que se reconstruye la tabla copiando todos los datos (receta oficial de SQLite).
function migrateUsersRole() {
    const current = tableSql('users');
    if (!current || current.includes("'profe'")) return;
    const ddl = SCHEMA.match(/CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/)[0]
        .replace('CREATE TABLE IF NOT EXISTS users', 'CREATE TABLE users_v2');
    const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name).join(', ');
    db.pragma('foreign_keys = OFF');
    try {
        db.transaction(() => {
            db.exec(ddl);
            db.exec(`INSERT INTO users_v2 (${cols}) SELECT ${cols} FROM users`);
            db.exec('DROP TABLE users');
            db.exec('ALTER TABLE users_v2 RENAME TO users');
            const broken = db.pragma('foreign_key_check');
            if (broken.length) throw new Error('La migración de usuarios dejó referencias rotas: ' + JSON.stringify(broken));
        })();
    } finally {
        db.pragma('foreign_keys = ON');
    }
    console.log('  ✔ Base actualizada: ahora existe el rol "profe".');
}

if (tableSql('users')) migrateUsersRole();
db.exec(SCHEMA);
if (!hasColumn('activities', 'location')) db.exec(`ALTER TABLE activities ADD COLUMN location TEXT NOT NULL DEFAULT ''`);
// Promos: dos columnas nuevas que reutilizan lo que ya había (un plan marcado como promo y un aviso con botón).
// ADD COLUMN no toca los datos existentes: los planes y avisos que ya estaban quedan igual (sin promo).
if (!hasColumn('plans', 'promo_until')) db.exec('ALTER TABLE plans ADD COLUMN promo_until TEXT');
if (!hasColumn('notifications', 'plan_id')) db.exec('ALTER TABLE notifications ADD COLUMN plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL');

/** Ejecuta una función dentro de una transacción (todo o nada). */
db.tx = (fn) => db.transaction(fn)();

module.exports = db;
