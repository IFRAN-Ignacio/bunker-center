'use strict';
const bcrypt = require('bcryptjs');
const config = require('../config');

const hash = (plain) => bcrypt.hash(plain, config.security.bcryptRounds);
const verify = (plain, hashed) => bcrypt.compare(plain, hashed);

// Hash "señuelo": se compara contra él cuando el usuario no existe, para que la
// respuesta tarde lo mismo y no se pueda averiguar qué correos están registrados.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', config.security.bcryptRounds);

module.exports = { hash, verify, DUMMY_HASH };
