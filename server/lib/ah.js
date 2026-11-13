'use strict';
/** Envuelve handlers async para que Express 4 capture sus errores. */
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
