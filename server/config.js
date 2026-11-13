'use strict';
/**
 * Configuración central. Todo valor sensible sale de variables de entorno (.env),
 * nunca del código ni del front.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const ROOT = path.join(__dirname, '..');
const isProd = process.env.NODE_ENV === 'production';

function int(name, def) {
    const v = parseInt(process.env[name], 10);
    return Number.isFinite(v) ? v : def;
}

const SITE = require('./seed-data').site;
const siteId = (process.env.SITE_ID || SITE.id).replace(/[^a-z0-9_]/gi, '').toLowerCase() || 'gym';

const config = {
    ROOT,
    isProd,
    // Identificador del sitio: separa las cookies si corren varios gyms en la misma PC (distintos puertos).
    siteId,
    siteName: SITE.name,
    port: int('PORT', 3000),
    host: process.env.HOST || '0.0.0.0',
    dbFile: process.env.DB_FILE ? path.resolve(ROOT, process.env.DB_FILE) : path.join(ROOT, 'data', `${siteId}.db`),
    uploadsDir: path.join(ROOT, 'uploads'),
    knowledgeDir: process.env.KNOWLEDGE_DIR ? path.resolve(ROOT, process.env.KNOWLEDGE_DIR) : path.join(ROOT, 'knowledge'),
    // Si el sitio corre detrás de un proxy (Nginx, Render, Railway…) hay que confiar en él
    // para leer bien la IP real del cliente (rate limit y auditoría).
    trustProxy: process.env.TRUST_PROXY === 'true' ? 1 : false,
    // Cookies "Secure" solo viajan por HTTPS. En producción SIEMPRE true.
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
    // Orígenes permitidos para peticiones que modifican datos (defensa extra contra CSRF).
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    timezone: process.env.TZ_GYM || 'America/Argentina/Buenos_Aires',

    session: {
        userTtlMs: int('SESSION_USER_HOURS', 24 * 7) * 3600 * 1000,
        adminTtlMs: int('SESSION_ADMIN_HOURS', 8) * 3600 * 1000,
        idleMs: int('SESSION_IDLE_HOURS', 48) * 3600 * 1000,
    },
    // Asistente con IA (pestaña "Asistente"). Sin clave funciona igual en "modo sin IA" (busca en los CSV).
    llm: {
        provider: (process.env.LLM_PROVIDER || '').trim().toLowerCase(),   // gemini | anthropic | openai | local
        apiKey: (process.env.LLM_API_KEY || '').trim(),
        model: (process.env.LLM_MODEL || '').trim(),
        baseUrl: (process.env.LLM_BASE_URL || '').trim().replace(/\/+$/, ''),
        timeoutMs: int('LLM_TIMEOUT_MS', 20000),
        dailyLimit: int('LLM_DAILY_LIMIT', 400),                         // tope de consultas a la IA por día (cuida el costo)
    },
    security: {
        bcryptRounds: 11,                                                // costo de bcrypt: 2^11 = 2048 vueltas
        maxFailedLogins: 5,
        lockMinutes: 15,
        maxAdminCodeAttempts: 5,
    },
};

module.exports = config;
