-- SQLite schema (docs/APP_SPEC.md, section 7.2). No migrations: delete app_data/hob.db to reset.

CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    birth_year      INTEGER,
    sex             TEXT CHECK (sex IN ('F','M')),
    height_cm       REAL,
    weight_kg       REAL,
    activity_score  REAL CHECK (activity_score IN (0, 0.32, 1.06, 1.76, 3.03)),
    avatar          TEXT,
    is_demo         INTEGER NOT NULL DEFAULT 0,
    persona_source  TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    status          TEXT NOT NULL DEFAULT 'setup'
                    CHECK (status IN ('setup','running','finished','aborted')),
    exercise        TEXT,
    source_type     TEXT NOT NULL CHECK (source_type IN ('replay','mock')),
    recording_id    TEXT,
    protocol        TEXT,
    summary         TEXT,
    timeline_path   TEXT,
    is_demo         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session_metrics (
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    phase           TEXT NOT NULL DEFAULT 'session'
                    CHECK (phase IN ('before','exercise','after','session')),
    value           REAL NOT NULL,
    source          TEXT NOT NULL CHECK (source IN ('real','simulated','user')),
    confidence      REAL,
    PRIMARY KEY (session_id, name, phase)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_time ON sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_metrics_user_name  ON session_metrics(user_id, name);
