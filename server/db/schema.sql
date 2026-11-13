-- =========================================================
-- BUNKER — Esquema de base de datos (SQLite)
-- Montos en pesos argentinos enteros. Fechas de calendario
-- como texto 'YYYY-MM-DD'; marcas de tiempo en ms (epoch).
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY,
    name            TEXT    NOT NULL,
    lastname        TEXT    NOT NULL,
    email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    phone           TEXT,
    password_hash   TEXT    NOT NULL,
    role            TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'profe', 'admin')),
    admin_code_hash TEXT,
    active          INTEGER NOT NULL DEFAULT 1,
    failed_logins   INTEGER NOT NULL DEFAULT 0,
    locked_until    INTEGER,
    created_at      INTEGER NOT NULL
);

-- El token de sesión NUNCA se guarda en claro: solo su hash SHA-256.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash          TEXT    PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_verified      INTEGER NOT NULL DEFAULT 0,
    admin_code_attempts INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL,
    last_seen           INTEGER NOT NULL,
    expires_at          INTEGER NOT NULL,
    ip                  TEXT,
    user_agent          TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS activities (
    id          INTEGER PRIMARY KEY,
    slug        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    short_name  TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    color       TEXT    NOT NULL DEFAULT '#9d4edd',
    icon        TEXT    NOT NULL DEFAULT 'pesa',
    location    TEXT    NOT NULL DEFAULT '',   -- sede o sala (opcional)
    active      INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schedule_slots (
    id          INTEGER PRIMARY KEY,
    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = domingo
    start_time  TEXT    NOT NULL,   -- 'HH:MM'
    end_time    TEXT    NOT NULL,
    capacity    INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 100),
    active      INTEGER NOT NULL DEFAULT 1,
    CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS ix_slots_activity ON schedule_slots(activity_id, weekday);

CREATE TABLE IF NOT EXISTS blocked_days (
    date       TEXT PRIMARY KEY,
    reason     TEXT NOT NULL DEFAULT 'No disponible',
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocked_slots (
    id         INTEGER PRIMARY KEY,
    slot_id    INTEGER NOT NULL REFERENCES schedule_slots(id) ON DELETE CASCADE,
    date       TEXT    NOT NULL,
    reason     TEXT    NOT NULL DEFAULT 'No disponible',
    created_at INTEGER NOT NULL,
    UNIQUE (slot_id, date)
);

-- Se guarda una "foto" de la clase (nombre, horario) para que el historial
-- no cambie si después el admin edita o borra el horario.
CREATE TABLE IF NOT EXISTS reservations (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot_id       INTEGER REFERENCES schedule_slots(id) ON DELETE SET NULL,
    activity_id   INTEGER REFERENCES activities(id) ON DELETE SET NULL,
    activity_name TEXT    NOT NULL,
    date          TEXT    NOT NULL,
    start_time    TEXT    NOT NULL,
    end_time      TEXT    NOT NULL,
    ticket        INTEGER NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'cancelada')),
    cancel_reason TEXT,
    hidden        INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    cancelled_at  INTEGER
);
-- Un boleto solo puede estar ocupado una vez, y un usuario no puede reservar dos veces la misma clase.
CREATE UNIQUE INDEX IF NOT EXISTS ux_res_ticket ON reservations(slot_id, date, ticket) WHERE status = 'activa';
CREATE UNIQUE INDEX IF NOT EXISTS ux_res_user   ON reservations(user_id, slot_id, date) WHERE status = 'activa';
CREATE INDEX IF NOT EXISTS ix_res_user_date ON reservations(user_id, date);
CREATE INDEX IF NOT EXISTS ix_res_date ON reservations(date);

CREATE TABLE IF NOT EXISTS plans (
    id            INTEGER PRIMARY KEY,
    name          TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    kind          TEXT    NOT NULL CHECK (kind IN ('membresia', 'actividad')),
    activity_id   INTEGER REFERENCES activities(id) ON DELETE RESTRICT,
    price         INTEGER NOT NULL CHECK (price >= 0),
    duration_days INTEGER NOT NULL DEFAULT 30 CHECK (duration_days BETWEEN 1 AND 366),
    weekly_limit  INTEGER CHECK (weekly_limit IS NULL OR weekly_limit BETWEEN 1 AND 14),
    featured      INTEGER NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    promo_until   TEXT,          -- PROMO: si tiene fecha, el plan es una promo y se oculta solo pasado ese día
    CHECK ((kind = 'membresia' AND activity_id IS NULL) OR (kind = 'actividad' AND activity_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id      INTEGER REFERENCES plans(id) ON DELETE SET NULL,
    plan_name    TEXT    NOT NULL,
    kind         TEXT    NOT NULL,
    activity_id  INTEGER,
    weekly_limit INTEGER,
    price        INTEGER NOT NULL,
    start_date   TEXT    NOT NULL,
    end_date     TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'activa', 'cancelada')),
    created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_subs_user ON subscriptions(user_id, status);

-- Mostrador de productos que se venden en el gym (sin compra online).
CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    category    TEXT    NOT NULL DEFAULT 'General',
    price       INTEGER NOT NULL CHECK (price >= 0),
    available   INTEGER NOT NULL DEFAULT 1,
    image       TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- Pagos: solo transferencia o efectivo (los aprueba el admin). card_brand, card_last4, gateway_ref y el
-- valor 'tarjeta' quedaron de una versión anterior: no se usan, se dejan para no migrar bases existentes.
CREATE TABLE IF NOT EXISTS payments (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
    description     TEXT    NOT NULL,
    amount          INTEGER NOT NULL CHECK (amount >= 0),
    method          TEXT    CHECK (method IS NULL OR method IN ('tarjeta', 'transferencia', 'efectivo')),
    status          TEXT    NOT NULL DEFAULT 'pendiente'
                    CHECK (status IN ('pendiente', 'en_revision', 'aprobado', 'rechazado', 'cancelado')),
    card_brand      TEXT,
    card_last4      TEXT,
    transfer_ref    TEXT,
    gateway_ref     TEXT,
    admin_note      TEXT,
    reviewed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pay_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS ix_pay_status ON payments(status);

CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY,
    message    TEXT    NOT NULL,
    type       TEXT    NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'warn', 'success')),
    active     INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    plan_id    INTEGER REFERENCES plans(id) ON DELETE SET NULL   -- PROMO: si apunta a un plan, el aviso lleva el botón "Ver promo"
);

CREATE TABLE IF NOT EXISTS opening_hours (
    weekday    INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
    is_open    INTEGER NOT NULL DEFAULT 1,
    open_time  TEXT,
    close_time TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Profes asignados a cada horario semanal (un horario puede tener varios profes).
CREATE TABLE IF NOT EXISTS slot_teachers (
    slot_id    INTEGER NOT NULL REFERENCES schedule_slots(id) ON DELETE CASCADE,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (slot_id, teacher_id)
);
CREATE INDEX IF NOT EXISTS ix_slot_teachers_teacher ON slot_teachers(teacher_id);

-- Ausencias que marca cada profe para una clase puntual (fecha + horario).
CREATE TABLE IF NOT EXISTS teacher_absences (
    id         INTEGER PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot_id    INTEGER NOT NULL REFERENCES schedule_slots(id) ON DELETE CASCADE,
    date       TEXT    NOT NULL,
    reason     TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (teacher_id, slot_id, date)
);
CREATE INDEX IF NOT EXISTS ix_absences_slot_date ON teacher_absences(slot_id, date);

CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT    NOT NULL,
    detail     TEXT,
    ip         TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_date ON audit_log(created_at);
