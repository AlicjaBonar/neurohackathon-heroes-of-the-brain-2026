"""FastAPI app: REST (APP_SPEC 3) + WebSocket stream (APP_SPEC 8.4).

Run:  .venv/Scripts/python -m uvicorn app.backend.main:app --reload --port 8000
Docs: http://localhost:8000/docs   OpenAPI: /openapi.json
"""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Literal, Optional

import pandas as pd
from fastapi import FastAPI, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config, db, repo, seed
from . import exercises as ex
from . import metrics as M
from . import runtime

CRF_METHOD = "Jurca 2005: sex, age, BMI, resting heart rate, activity survey"


# ---------------------------------------------------------------------------- errors

class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def _err(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


# ---------------------------------------------------------------------------- app

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    with db.get_conn() as conn:
        if not repo.list_demo_users(conn) and seed.available():
            seed.seed(conn)
    yield


app = FastAPI(title="Breath, Brain & Body API", version=config.VERSION, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(ApiError)
async def _api_error(_: Request, e: ApiError):
    return _err(e.status, e.code, e.message)


@app.exception_handler(StarletteHTTPException)
async def _http_error(_: Request, e: StarletteHTTPException):
    return _err(e.status_code, "http_error", str(e.detail))


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, e: RequestValidationError):
    msg = "; ".join(f"{'.'.join(str(x) for x in d['loc'])}: {d['msg']}" for d in e.errors())
    return _err(422, "validation_error", msg)


# ---------------------------------------------------------------------------- models

class Avatar(BaseModel):
    hair_color: Optional[str] = None
    hair_texture: Optional[str] = None
    hair_length: Optional[str] = None
    skin_tone: Optional[int] = Field(None, ge=1, le=6)


class UserIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    birth_year: Optional[int] = Field(None, ge=1900, le=2025)
    sex: Optional[Literal["F", "M"]] = None
    height_cm: Optional[float] = Field(None, gt=50, lt=250)
    weight_kg: Optional[float] = Field(None, gt=20, lt=300)
    activity_score: Optional[Literal[0, 0.32, 1.06, 1.76, 3.03]] = None
    avatar: Optional[Avatar] = None


class SourceIn(BaseModel):
    type: Literal["mock", "replay"] = "mock"
    recording_id: Optional[str] = None
    baseline_s: float = Field(120.0, ge=2, le=600, description="length of baseline_pre / baseline_post [s]")


class SessionIn(BaseModel):
    user_id: str
    source: SourceIn = SourceIn()
    protocol: list[str] = ["baseline_pre", "resonance_breathing", "baseline_post"]


class PhaseIn(BaseModel):
    phase: str
    action: Literal["start"] = "start"


class EventIn(BaseModel):
    name: Literal["hold_end_button"]


# ---------------------------------------------------------------------------- helpers

def _user_or_404(conn, uid: str) -> dict:
    u = repo.get_user(conn, uid)
    if not u:
        raise ApiError(404, "user_not_found", f"User {uid} not found")
    return u


def _session_or_404(conn, sid: str) -> dict:
    s = repo.get_session(conn, sid)
    if not s:
        raise ApiError(404, "session_not_found", f"Session {sid} not found")
    return s


def _public_session(s: dict, ls=None) -> dict:
    out = {k: v for k, v in s.items() if k != "summary"}
    out["has_summary"] = s["summary"] is not None
    if ls:
        out["live"] = dict(phase=ls.phase, t=round(ls.src.t, 1), phases_done=ls.phase_log)
    return out


# ---------------------------------------------------------------------------- health / users

@app.get("/api/health")
def health():
    return dict(status="ok", version=config.VERSION, protocol=config.PROTOCOL_VERSION,
                demo_data=seed.available())


@app.post("/api/users", status_code=201)
def create_user(body: UserIn):
    with db.get_conn() as conn:
        return repo.create_user(conn, body.model_dump())


@app.get("/api/users/{uid}")
def get_user(uid: str):
    with db.get_conn() as conn:
        return _user_or_404(conn, uid)


@app.put("/api/users/{uid}")
def put_user(uid: str, body: UserIn):
    with db.get_conn() as conn:
        _user_or_404(conn, uid)
        return repo.update_user(conn, uid, body.model_dump())


@app.get("/api/users/{uid}/dashboard")
def dashboard(uid: str):
    with db.get_conn() as conn:
        u = _user_or_404(conn, uid)
        hr = repo.metric_series(conn, uid, "hr_bpm", "before")
        rm = repo.metric_series(conn, uid, "rmssd_ms", "before")

        def readiness(series):
            if not series:
                return None
            last, prev = series[-1], [x["value"] for x in series[-8:-1]]
            base = M.mean(prev)
            return dict(value=round(last["value"], 1), t=last["t"], source=last["source"],
                        baseline=round(base, 1) if base else None,
                        delta=round(last["value"] - base, 1) if base else None)

        h, r = readiness(hr), readiness(rm)
        text = None
        if h and h["delta"] is not None:
            if h["delta"] <= -2:
                text = "Resting heart rate lower than usual – good recovery."
            elif h["delta"] >= 3:
                text = "Resting heart rate higher than usual – maybe take it easy today."
            else:
                text = "Resting heart rate within your normal range."
        crf = repo.metric_series(conn, uid, "crf_mets", "session")
        last_sessions = conn.execute(
            "SELECT id, started_at, exercise, status FROM sessions WHERE user_id = ? AND status = 'finished'"
            " ORDER BY started_at DESC LIMIT 5", (uid,)).fetchall()
        spark = {name: [dict(t=x["t"], value=x["value"]) for x in repo.metric_series(conn, uid, name, ph)[-10:]]
                 for name, ph in (("hr_bpm", "before"), ("rmssd_ms", "before"), ("resonance_score", "exercise"))}
        return dict(
            user=dict(id=u["id"], name=u["name"], avatar=u["avatar"]),
            readiness=dict(hr_rest=h, rmssd=r, text=text),
            fitness=dict(crf_mets=round(crf[-1]["value"], 1) if crf else None,
                         trend=[dict(t=x["t"], value=round(x["value"], 1)) for x in crf[-10:]],
                         method=CRF_METHOD),
            records=dict(hold_s=repo.metric_best(conn, uid, "hold_s"),
                         resonance_score=repo.metric_best(conn, uid, "resonance_score")),
            sparklines=spark,
            last_sessions=[dict(r) for r in last_sessions],
        )


@app.get("/api/users/{uid}/history")
def history(uid: str, metrics: str = Query("hr_bpm,rmssd_ms,resonance_score,hold_s,crf_mets"),
            phase: Optional[str] = None, t_from: Optional[str] = Query(None, alias="from"),
            t_to: Optional[str] = Query(None, alias="to"), by_hour: bool = False):
    default_phase = {"resonance_score": "exercise", "phase_lock": "exercise", "hold_s": "exercise",
                     "hold_hbo_peak_uM": "exercise", "crf_mets": "session", "relaxation_score": "session"}
    with db.get_conn() as conn:
        _user_or_404(conn, uid)
        out, baseline, hours = {}, {}, {}
        for name in [m.strip() for m in metrics.split(",") if m.strip()]:
            ph = phase or default_phase.get(name)
            ser = repo.metric_series(conn, uid, name, ph, t_from, t_to)
            out[name] = [dict(t=x["t"], value=round(x["value"], 3), source=x["source"],
                              session_id=x["session_id"]) for x in ser]
            vals = [x["value"] for x in ser[-7:]]
            baseline[name] = round(M.mean(vals), 2) if vals else None
            if by_hour:
                hours[name] = repo.metric_by_hour(conn, uid, name, ph)
        res = dict(metrics=out, baseline=baseline)
        if by_hour:
            res["by_hour"] = hours
        return res


@app.get("/api/users/{uid}/fitness")
def fitness(uid: str):
    with db.get_conn() as conn:
        u = _user_or_404(conn, uid)
        hr = repo.metric_series(conn, uid, "hr_bpm", "before")
        hr_rest = M.mean([x["value"] for x in hr[-7:]]) if hr else None
        d = u["derived"]
        crf = M.crf_jurca(u["sex"], d["age"], d["bmi"], hr_rest, u["activity_score"])
        trend = repo.metric_series(conn, uid, "crf_mets", "session")
        rec = repo.metric_series(conn, uid, "hr_recovery_drop_bpm", "after")
        return dict(
            crf_mets=round(crf, 1) if crf else None,
            method=CRF_METHOD,
            components=dict(
                hr_rest_bpm=dict(value=round(hr_rest, 1) if hr_rest else None,
                                 source=hr[-1]["source"] if hr else None),
                activity_score=dict(value=u["activity_score"], source="user"),
                bmi=dict(value=d["bmi"], source="user"), age=dict(value=d["age"], source="user"),
                sex=dict(value=u["sex"], source="user")),
            hr_recovery=dict(drop_1min_bpm=round(rec[-1]["value"], 1), source="simulated",
                             note="simulated – the dataset has no exercise data") if rec else None,
            trend=[dict(t=x["t"], crf_mets=round(x["value"], 2)) for x in trend],
            missing=[k for k, v in dict(sex=u["sex"], age=d["age"], bmi=d["bmi"], hr_rest=hr_rest,
                                        activity=u["activity_score"]).items() if v is None],
        )


# ---------------------------------------------------------------------------- catalogue

@app.get("/api/exercises")
def exercises():
    return ex.catalog()


@app.get("/api/sources")
def sources(dataset: Optional[str] = None, task: Optional[str] = None):
    recs = []
    files = config.RESULTS / "features.csv"
    if files.exists():
        fe = pd.read_csv(files, usecols=["dataset", "subject", "task", "session", "duration_s", "fs", "n_events"])
        if dataset:
            fe = fe[fe.dataset == dataset]
        if task:
            fe = fe[fe.task == task]
        suggest = {"RS": ["baseline"], "BS": ["baseline"], "SPB": ["resonance_breathing"],
                   "BH": ["short_holds", "breath_hold"]}
        for r in fe.itertuples():
            rid = (f"dot/{r.subject:02d}/{r.task}{r.session}" if r.dataset == "dot"
                   else f"supine/{r.subject}/{r.task}")
            recs.append(dict(id=rid, dataset=r.dataset, subject=int(r.subject), task=r.task,
                             session=int(r.session), duration_s=round(r.duration_s, 1), fs_hz=round(r.fs, 2),
                             has_markers=bool(r.n_events), suggested_for=suggest.get(r.task, []),
                             available=True))
    return dict(recordings=recs,
                mock=[dict(type="mock", label="Simulation", available=True)],
                note="replay: pass the person's recording_id ('dot/03', 'supine/10'); session phases are mapped to their recordings.")


# ---------------------------------------------------------------------------- sessions

@app.post("/api/sessions", status_code=201)
def create_session(body: SessionIn):
    bad = [p for p in body.protocol if p not in ex.PHASES]
    if bad:
        raise ApiError(422, "unknown_phase", f"Unknown phases: {bad}. Allowed: {list(ex.PHASES)}")
    exs = [p for p in body.protocol if p in ex.EXERCISE_IDS]
    if len(exs) > 1:
        raise ApiError(422, "multiple_exercises", "A session contains at most one exercise phase.")
    with db.get_conn() as conn:
        u = _user_or_404(conn, body.user_id)
    rec_id, device = None, dict(fs_hz=10.0, n_pairs=10, montage="mock_prefrontal", source="simulated")
    if body.source.type == "replay":
        from . import replay
        rec_id = body.source.recording_id or u["persona_source"]
        if not rec_id:
            raise ApiError(422, "recording_required", "source.recording_id is required (e.g. 'dot/03' or 'supine/10')")
        try:
            avail = replay.available_phases(rec_id)
        except replay.RecordingNotFound as e:
            raise ApiError(404, "recording_not_found", str(e))
        missing = [p for p in body.protocol if p not in avail]
        if missing:
            raise ApiError(422, "phase_not_available",
                           f"{missing} not available for {rec_id}. Available: {sorted(avail)}")
        ds = replay.parse_id(rec_id)[0]
        device = dict(fs_hz=10.0, n_pairs=95 if ds == "dot" else 10,
                      montage="dot_frontal" if ds == "dot" else "sparse_prefrontal", source="real")
    with db.get_conn() as conn:
        s = repo.create_session(conn, user_id=body.user_id, source_type=body.source.type,
                                recording_id=rec_id, protocol=body.protocol,
                                exercise=exs[0] if exs else "baseline_only")
    runtime.baseline_opts[s["id"]] = body.source.baseline_s
    return dict(session_id=s["id"], ws_url=f"/ws/sessions/{s['id']}", device=device, recording_id=rec_id,
                phase="setup", protocol=s["protocol"], exercise=s["exercise"])


@app.get("/api/sessions/{sid}")
def get_session(sid: str):
    with db.get_conn() as conn:
        s = _session_or_404(conn, sid)
    return _public_session(s, runtime.sessions.get(sid))


@app.get("/api/sessions/{sid}/probe")
def probe(sid: str):
    with db.get_conn() as conn:
        s = _session_or_404(conn, sid)
    ls = runtime.sessions.get(sid)
    if ls:
        return ls.src.probe()
    if s["source_type"] == "replay":
        from .replay import probe_for
        return probe_for(s["recording_id"])
    from .mock_source import MockSource
    return MockSource(seed=0).probe()


def _live_or_409(sid: str):
    with db.get_conn() as conn:
        s = _session_or_404(conn, sid)
    if s["status"] in ("finished", "aborted"):
        raise ApiError(409, "session_closed", f"Session is {s['status']}")
    ls = runtime.sessions.get(sid)
    if ls is None:
        raise ApiError(409, "session_not_connected", "Connect to the WebSocket first.")
    return ls


@app.post("/api/sessions/{sid}/phases")
async def start_phase(sid: str, body: PhaseIn):
    ls = _live_or_409(sid)
    err = await _locked(ls, ls.start_phase, body.phase)
    if err:
        raise ApiError(409, err, f"Cannot start phase {body.phase}: {err}")
    return dict(phase=body.phase, state="started", t=round(ls.src.t, 2))


@app.post("/api/sessions/{sid}/events")
async def user_event(sid: str, body: EventIn):
    ls = _live_or_409(sid)
    if not await _locked(ls, ls.user_event, body.name):
        raise ApiError(409, "event_not_applicable", f"{body.name} is not valid in the current phase")
    return dict(accepted=True, t=round(ls.src.t, 2))


@app.post("/api/sessions/{sid}/finish")
async def finish(sid: str):
    with db.get_conn() as conn:
        s = _session_or_404(conn, sid)
    if s["status"] == "finished":
        return s["summary"]
    if s["status"] == "aborted":
        raise ApiError(409, "session_closed", "Session was aborted")
    ls = runtime.sessions.get(sid)
    if ls is None or not ls.phase_log and not ls.phase:
        raise ApiError(409, "nothing_measured", "No phase has been run in this session.")
    return await _locked(ls, ls.finish)


@app.get("/api/sessions/{sid}/summary")
def summary(sid: str):
    with db.get_conn() as conn:
        s = _session_or_404(conn, sid)
    if not s["summary"]:
        raise ApiError(409, "summary_not_ready", "Finish the session first.")
    return s["summary"]


@app.get("/api/sessions/{sid}/timeline")
def timeline(sid: str):
    with db.get_conn() as conn:
        s = _session_or_404(conn, sid)
    if not s["timeline_path"]:
        raise ApiError(404, "timeline_not_found", "No timeline for this session.")
    p = config.ROOT / s["timeline_path"]
    if not p.exists():
        p = config.TIMELINES / f"{sid}.json"
    return json.loads(p.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------- demo

@app.get("/api/demo/personas")
def personas():
    with db.get_conn() as conn:
        return [dict(id=u["id"], name=u["name"], source=u["persona_source"], sex=u["sex"],
                     age=u["derived"]["age"], bmi=u["derived"]["bmi"], activity_score=u["activity_score"],
                     avatar=u["avatar"], n_sessions=u["n_sessions"]) for u in repo.list_demo_users(conn)]


@app.post("/api/demo/personas/{uid}/load")
def load_persona(uid: str):
    with db.get_conn() as conn:
        u = _user_or_404(conn, uid)
        if not u["is_demo"]:
            raise ApiError(409, "not_a_persona", "Only demo personas can be loaded.")
    return dashboard(uid)


@app.post("/api/demo/reset")
def demo_reset():
    with db.get_conn() as conn:
        return seed.reset(conn)


# ---------------------------------------------------------------------------- websocket

async def _locked(ls: runtime.LiveSession, fn, *args):
    """Run a session method in a worker thread: replay loads SNIRF files and runs NeuroKit,
    which would otherwise freeze the event loop and every live stream with it."""
    def run():
        with ls.lock:
            return fn(*args)
    return await asyncio.to_thread(run)


async def _read_commands(ws: WebSocket, ls: runtime.LiveSession) -> None:
    """Commands from the client; replies/errors go to ls.outbox and are sent with the next tick."""
    def error(code, message):
        ls.outbox.append(dict(type="error", code=code, message=message, fatal=False))

    while True:
        try:
            msg = await ws.receive_json()
        except (ValueError, KeyError):
            error("bad_message", "Expected JSON")
            continue
        kind, action = msg.get("type"), msg.get("action")
        if kind == "ping":
            ls.outbox.append(dict(type="pong", t=msg.get("t")))
        elif kind == "hello":
            pass                                   # optional; the server greets on connect
        elif kind == "command" and action == "start_phase":
            err = await _locked(ls, ls.start_phase, msg.get("phase", ""))
            if err:
                error(err, f"Cannot start phase {msg.get('phase')}")
        else:
            error("unknown_message", f"Unknown message type={kind} action={action}")


@app.websocket("/ws/sessions/{sid}")
async def ws_session(ws: WebSocket, sid: str):
    await ws.accept()
    with db.get_conn() as conn:
        s = repo.get_session(conn, sid)
        user = repo.get_user(conn, s["user_id"]) if s else None
    if not s:
        await ws.close(code=4004, reason="session_not_found")
        return
    if s["status"] in ("finished", "aborted"):
        await ws.close(code=4009, reason="session_closed")
        return

    ls = runtime.sessions.get(sid)
    if ls is None:
        ls = await asyncio.to_thread(runtime.LiveSession, s, user, runtime.baseline_opts.get(sid, 120.0))
        ls = runtime.sessions.setdefault(sid, ls)
    if hasattr(ls.src, "prefetch"):
        asyncio.create_task(asyncio.to_thread(ls.src.prefetch, ls.exercise))
    await ws.send_json(dict(type="hello", protocol=config.PROTOCOL_VERSION, session_id=sid, fs_hz=10.0))
    if ls.phase:
        await ws.send_json(dict(type="phase", t=round(ls.src.t, 2), phase=ls.phase, state="started"))

    reader = asyncio.create_task(_read_commands(ws, ls))
    try:
        loop = asyncio.get_running_loop()
        next_at = loop.time()
        while not ls.ended and not reader.done():
            for m in await _locked(ls, ls.tick):
                await ws.send_json(m)
            # Fixed 10 Hz clock: sleep until the next slot instead of a fixed 0.1 s after the work.
            next_at = max(next_at + runtime.TICK_S, loop.time() - runtime.TICK_S)
            await asyncio.sleep(max(0.0, next_at - loop.time()))
        if ls.ended:
            await ws.send_json(dict(type="end", reason="finished", summary_url=f"/api/sessions/{sid}/summary"))
            await ws.close(code=1000)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        reader.cancel()
