"""Data access: users, sessions, metrics. All functions take an open sqlite3 connection."""
from __future__ import annotations

import json
import secrets
import sqlite3
from datetime import datetime, timezone

# default phase used when a history/dashboard query does not name one
DEFAULT_PHASE = {"hr_bpm": "before", "rmssd_ms": "before", "resp_rate_bpm": "before"}


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def new_id(prefix: str, nbytes: int = 4) -> str:
    return f"{prefix}_{secrets.token_hex(nbytes)}"


# ----------------------------------------------------------------------------- users

def _user(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    u = dict(row)
    u["avatar"] = json.loads(u["avatar"]) if u["avatar"] else None
    u["is_demo"] = bool(u["is_demo"])
    age = datetime.now().year - u["birth_year"] if u["birth_year"] else None
    bmi = (round(u["weight_kg"] / (u["height_cm"] / 100) ** 2, 1)
           if u["weight_kg"] and u["height_cm"] else None)
    u["derived"] = {"age": age, "bmi": bmi}
    return u


def create_user(conn, data: dict, user_id: str | None = None, is_demo: bool = False,
                persona_source: str | None = None) -> dict:
    uid = user_id or new_id("u", 3)
    conn.execute(
        "INSERT INTO users (id, name, birth_year, sex, height_cm, weight_kg, activity_score, avatar,"
        " is_demo, persona_source) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (uid, data["name"], data.get("birth_year"), data.get("sex"), data.get("height_cm"),
         data.get("weight_kg"), data.get("activity_score"),
         json.dumps(data["avatar"]) if data.get("avatar") else None, int(is_demo), persona_source))
    return get_user(conn, uid)


def get_user(conn, uid: str) -> dict | None:
    return _user(conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone())


def update_user(conn, uid: str, data: dict) -> dict | None:
    conn.execute(
        "UPDATE users SET name=?, birth_year=?, sex=?, height_cm=?, weight_kg=?, activity_score=?, avatar=?"
        " WHERE id=?",
        (data["name"], data.get("birth_year"), data.get("sex"), data.get("height_cm"),
         data.get("weight_kg"), data.get("activity_score"),
         json.dumps(data["avatar"]) if data.get("avatar") else None, uid))
    return get_user(conn, uid)


def list_demo_users(conn) -> list[dict]:
    rows = conn.execute(
        "SELECT u.*, (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS n_sessions"
        " FROM users u WHERE u.is_demo = 1 ORDER BY u.id").fetchall()
    out = []
    for r in rows:
        u = _user(r)
        u["n_sessions"] = r["n_sessions"]
        out.append(u)
    return out


def delete_demo(conn) -> int:
    return conn.execute("DELETE FROM users WHERE is_demo = 1").rowcount


# ----------------------------------------------------------------------------- sessions

def _session(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    s = dict(row)
    s["protocol"] = json.loads(s["protocol"]) if s["protocol"] else []
    s["summary"] = json.loads(s["summary"]) if s["summary"] else None
    s["is_demo"] = bool(s["is_demo"])
    return s


def create_session(conn, *, user_id: str, source_type: str, recording_id: str | None,
                   protocol: list[str], exercise: str, session_id: str | None = None,
                   started_at: str | None = None, is_demo: bool = False) -> dict:
    sid = session_id or new_id("s")
    conn.execute(
        "INSERT INTO sessions (id, user_id, started_at, exercise, source_type, recording_id, protocol, is_demo)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (sid, user_id, started_at or now_iso(), exercise, source_type, recording_id,
         json.dumps(protocol), int(is_demo)))
    return get_session(conn, sid)


def get_session(conn, sid: str) -> dict | None:
    return _session(conn.execute("SELECT * FROM sessions WHERE id = ?", (sid,)).fetchone())


def set_status(conn, sid: str, status: str) -> None:
    conn.execute("UPDATE sessions SET status = ? WHERE id = ?", (status, sid))


def finish_session(conn, sid: str, user_id: str, summary: dict, metrics: list[dict],
                   timeline_path: str | None, finished_at: str | None = None) -> None:
    """Close a session: summary JSON + one row per metric (single transaction via get_conn)."""
    conn.execute(
        "UPDATE sessions SET status='finished', finished_at=?, summary=?, timeline_path=? WHERE id=?",
        (finished_at or now_iso(), json.dumps(summary, ensure_ascii=False), timeline_path, sid))
    conn.executemany(
        "INSERT OR REPLACE INTO session_metrics (session_id, user_id, name, phase, value, source, confidence)"
        " VALUES (?,?,?,?,?,?,?)",
        [(sid, user_id, m["name"], m.get("phase", "session"), float(m["value"]), m["source"],
          m.get("confidence")) for m in metrics if m.get("value") is not None])


# ----------------------------------------------------------------------------- metrics

def metric_series(conn, uid: str, name: str, phase: str | None = None,
                  t_from: str | None = None, t_to: str | None = None) -> list[dict]:
    phase = phase or DEFAULT_PHASE.get(name)
    q = ("SELECT s.started_at AS t, m.value, m.source, m.phase, m.session_id"
         " FROM session_metrics m JOIN sessions s ON s.id = m.session_id"
         " WHERE m.user_id = ? AND m.name = ? AND s.status = 'finished'")
    args: list = [uid, name]
    if phase:
        q += " AND m.phase = ?"; args.append(phase)
    if t_from:
        q += " AND s.started_at >= ?"; args.append(t_from)
    if t_to:
        q += " AND s.started_at <= ?"; args.append(t_to)
    return [dict(r) for r in conn.execute(q + " ORDER BY s.started_at", args)]


def metric_best(conn, uid: str, name: str) -> dict | None:
    r = conn.execute(
        "SELECT m.value, s.started_at AS t, m.source FROM session_metrics m"
        " JOIN sessions s ON s.id = m.session_id"
        " WHERE m.user_id = ? AND m.name = ? ORDER BY m.value DESC LIMIT 1", (uid, name)).fetchone()
    return dict(r) if r else None


def metric_by_hour(conn, uid: str, name: str, phase: str | None = None) -> list[dict]:
    phase = phase or DEFAULT_PHASE.get(name)
    q = ("SELECT CAST(strftime('%H', s.started_at) AS INTEGER) AS hour, AVG(m.value) AS value, COUNT(*) AS n"
         " FROM session_metrics m JOIN sessions s ON s.id = m.session_id"
         " WHERE m.user_id = ? AND m.name = ?")
    args: list = [uid, name]
    if phase:
        q += " AND m.phase = ?"; args.append(phase)
    return [dict(r) for r in conn.execute(q + " GROUP BY hour ORDER BY hour", args)]
