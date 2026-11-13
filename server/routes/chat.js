'use strict';
/** Chat del asistente (público: no hace falta cuenta). */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { parse, z } = require('../lib/util');
const assistant = require('../services/assistant');
const ah = require('../lib/ah');

const router = express.Router();

// Por IP: 10 mensajes por minuto y 80 por día. Frena abuso y protege el costo de la IA.
const perMinute = rateLimit({
    windowMs: 60 * 1000, limit: 10,
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Estás mandando muchos mensajes seguidos. Esperá un minuto.' },
});
const perDay = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, limit: 80,
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Llegaste al límite de consultas de hoy. Escribinos por WhatsApp.' },
});

const clean = (max) => z.string().transform(s => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
    .pipe(z.string().min(1, 'Escribí tu consulta.').max(max, `El mensaje no puede superar ${max} caracteres.`));

const chatSchema = z.object({
    messages: z.array(z.discriminatedUnion('role', [
        z.object({ role: z.literal('user'), content: clean(500) }),
        z.object({ role: z.literal('assistant'), content: clean(2000) }),
    ])).min(1).max(12),
}).refine(b => b.messages[b.messages.length - 1].role === 'user', { message: 'El último mensaje tiene que ser tuyo.' });

router.post('/', perMinute, perDay, ah(async (req, res) => {
    const { messages } = parse(chatSchema, req.body);
    const out = await assistant.answer(messages);
    res.json(out);
}));

router.get('/status', (req, res) => {
    res.json({ mode: assistant.providerInfo().provider === 'local' ? 'local' : 'ia' });
});

module.exports = router;
