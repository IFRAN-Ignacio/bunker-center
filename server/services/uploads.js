'use strict';
/**
 * Subida segura de imágenes de productos:
 * - tamaño máximo 2 MB, un solo archivo
 * - el tipo se verifica por los "magic bytes" del contenido, no por la extensión ni el MIME que manda el cliente
 * - el nombre lo genera el servidor (aleatorio) → no hay path traversal ni sobrescritura
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { httpError } = require('../lib/util');

const DIR = path.join(config.uploadsDir, 'products');
fs.mkdirSync(DIR, { recursive: true });

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 20 },
});

function detectImage(buf) {
    if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
    if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'png';
    if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    return null;
}

function saveProductImage(file) {
    if (!file) return null;
    const ext = detectImage(file.buffer);
    if (!ext) throw httpError(400, 'La imagen tiene que ser JPG, PNG o WEBP.', { field: 'image' });
    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(DIR, name), file.buffer, { flag: 'wx' });
    return name;
}

function deleteProductImage(name) {
    if (!name || !/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(name)) return;
    fs.rm(path.join(DIR, name), { force: true }, () => {});
}

/** Middleware que traduce los errores de multer a mensajes claros. */
const singleImage = (req, res, next) => upload.single('image')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(httpError(400, 'La imagen no puede superar 2 MB.', { field: 'image' }));
    return next(httpError(400, 'No se pudo procesar el archivo.'));
});

module.exports = { singleImage, saveProductImage, deleteProductImage };
