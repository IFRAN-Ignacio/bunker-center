'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { HttpError } = require('./lib/util');
const { loadSession, ensureCsrfCookie, verifyCsrf } = require('./security/auth');

// El asistente lee solo archivos CSV generados desde la base: se crean/actualizan al arrancar.
require('./services/knowledge').init();

const app = express();
app.disable('x-powered-by');            // no revelar la tecnología del servidor
app.set('trust proxy', config.trustProxy);

/* ---------- Cabeceras de seguridad (Helmet + CSP) ---------- */
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],                                   // sin scripts inline ni de terceros → frena XSS
            styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
            frameSrc: ['https://www.google.com', 'https://maps.google.com'],                   // mapa de Google
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],                             // nadie puede meter el sitio en un iframe (clickjacking)
            ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
        },
    },
    hsts: config.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use((req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    next();
});

/* ---------- API ---------- */
const api = express.Router();
api.use(rateLimit({
    windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Demasiadas peticiones. Esperá un momento.' },
}));
api.use(express.json({ limit: '50kb' }));    // cuerpos chicos: evita abuso de memoria
api.use(cookieParser());
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
api.use(loadSession);
api.use(ensureCsrfCookie);
api.use(verifyCsrf);

api.use('/auth', require('./routes/auth'));
api.use('/public', require('./routes/public'));
api.use('/reservations', require('./routes/reservations'));
api.use('/account', require('./routes/account'));
api.use('/teacher', require('./routes/teacher'));
api.use('/chat', require('./routes/chat'));
api.use('/admin', require('./routes/admin'));
api.use((req, res) => res.status(404).json({ error: 'No encontrado.' }));

app.use('/api', api);

/* ---------- Archivos estáticos (solo carpetas públicas, nunca server/ ni .env) ---------- */
const staticOpts = { index: false, dotfiles: 'deny', fallthrough: true, maxAge: config.isProd ? '1h' : 0 };
app.use('/css', express.static(path.join(config.ROOT, 'css'), staticOpts));
app.use('/mains', express.static(path.join(config.ROOT, 'mains'), staticOpts));
app.use('/img', express.static(path.join(config.ROOT, 'img'), staticOpts));
app.use('/uploads', express.static(config.uploadsDir, {
    ...staticOpts,
    setHeaders: (res) => res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'"),
}));
app.use('/page', express.static(path.join(config.ROOT, 'page'), { ...staticOpts, extensions: ['html'] }));

app.get('/', (req, res) => res.redirect('/page/index.html'));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/img/logo.jpg'));

app.use((req, res) => res.status(404).sendFile(path.join(config.ROOT, 'page', '404.html')));

/* ---------- Manejo de errores: nunca se muestra el stack ni detalles internos ---------- */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Datos demasiado grandes.' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: 'Ocurrió un error inesperado. Probá de nuevo.' });
});

module.exports = app;
