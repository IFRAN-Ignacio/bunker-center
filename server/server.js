'use strict';
const config = require('./config');
const db = require('./db');
const app = require('./app');
const { cleanupSessions } = require('./security/auth');
const { expireStale } = require('./services/payments');
const knowledge = require('./services/knowledge');

const adminExists = db.prepare(`SELECT 1 FROM users WHERE role = 'admin'`).get();
if (!adminExists) {
    console.warn('\n⚠  No hay ningún administrador creado. Ejecutá:  npm run seed\n');
}

function housekeeping() {
    try { cleanupSessions(); expireStale(); knowledge.exportPublic(); } catch (e) { console.error('Tarea de mantenimiento falló:', e.message); }
}
housekeeping();
setInterval(housekeeping, 60 * 60 * 1000).unref();

const server = app.listen(config.port, config.host, () => {
    console.log(`\n  ${config.siteName.toUpperCase()} corriendo en http://localhost:${config.port}`);
    console.log(`  Modo: ${config.isProd ? 'producción' : 'desarrollo'}  ·  Base: ${config.dbFile}`);
    const ai = require('./services/assistant').providerInfo();
    console.log(`  Asistente: ${ai.provider === 'local' ? 'modo sin IA (configurá LLM_API_KEY en .env para usar IA)' : `${ai.provider} · ${ai.model}`}\n`);
});

function shutdown() {
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
