"""Live session state for the demo: mock source + phase bookkeeping + summary.

Deliberately simple: sessions live in a dict, the WebSocket handler (main.py) calls tick()
every 0.1 s and sends whatever it returns.
"""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field

from . import config, db, repo
from . import exercises as ex
from . import metrics as M
from .mock_source import MockSource

TICK_S = 0.1


@dataclass
class PhaseAcc:
    t0: float
    t1: float | None = None
    hr: list[float] = field(default_factory=list)
    rmssd: list[float] = field(default_factory=list)
    resp: list[float] = field(default_factory=list)
    resonance: list[float] = field(default_factory=list)
    phase_lock: float | None = None
    frames: int = 0
    unstill: int = 0


class LiveSession:
    def __init__(self, session: dict, user: dict | None, baseline_s: float = 120.0):
        self.id = session["id"]
        self.user_id = session["user_id"]
        self.user = user
        # tick() runs in a worker thread (main.ws_session); commands take the same lock.
        self.lock = threading.Lock()
        self.exercise = session["exercise"]
        self.status = session["status"]
        if session["source_type"] == "replay":
            from .replay import ReplaySource
            age = ((user or {}).get("derived") or {}).get("age")
            self.src = ReplaySource(session["recording_id"], age, baseline_s)
            self.kind = "real"
        else:
            self.src = MockSource(baseline_s=baseline_s)
            self.kind = "simulated"
        self.phase: str | None = None
        self.phases: dict[str, PhaseAcc] = {}
        self.phase_log: list[dict] = []
        self.events: list[dict] = []
        self.timeline: dict[str, list] = {k: [] for k in
                                          ("t", "phase", "hr_bpm", "breath_signal", "resonance_score", "motion_level")}
        self.outbox: list[dict] = []        # messages produced outside tick() (phase start, errors)
        self.last_quality: dict | None = None
        self.ended = False
        self._next_vitals = 1.0
        self._next_quality = 0.0
        self._next_channels = 0.0

    # ------------------------------------------------------------------ commands
    def start_phase(self, phase: str) -> str | None:
        """Returns an error code or None."""
        if self.ended:
            return "session_finished"
        if phase not in ex.PHASES:
            return "unknown_phase"
        if self.phase:
            return "phase_already_running"
        if phase in ex.EXERCISE_IDS and phase != self.exercise:
            return "phase_not_in_protocol"
        try:
            dur = self.src.start_phase(phase)
        except Exception as e:                     # e.g. phase not available for this recording
            return f"phase_not_available: {e}"
        self.phase = phase
        self.phases[phase] = PhaseAcc(t0=self.src.t)
        self.outbox.append(dict(type="phase", t=round(self.src.t, 2), phase=phase, state="started", duration_s=dur))
        if self.status == "setup":
            self.status = "running"
            with db.get_conn() as conn:
                repo.set_status(conn, self.id, "running")
        return None

    def _finish_phase(self) -> None:
        acc = self.phases[self.phase]
        acc.t1 = self.src.t
        self.phase_log.append(dict(name=self.phase, t0=round(acc.t0, 1), t1=round(acc.t1, 1)))
        self.outbox.append(dict(type="phase", t=round(self.src.t, 2), phase=self.phase, state="finished",
                                duration_s=round(acc.t1 - acc.t0, 1)))
        self.phase = None

    # ------------------------------------------------------------------ one step (0.1 s)
    def tick(self) -> list[dict]:
        out = self.src.step(TICK_S)
        t = self.src.t
        msgs = [dict(type="frame", **{k: v for k, v in out.frame.items() if v is not None})]
        msgs += [dict(type="beat", t=bt, ibi_ms=ibi, source="simulated") for bt, ibi in out.beats]
        for e in out.events:
            self.events.append({**e, "phase": self.phase})
            msgs.append(dict(type="event", **{k: v for k, v in e.items() if v is not None}))

        acc = self.phases.get(self.phase) if self.phase else None
        if acc:
            acc.frames += 1
            acc.unstill += 0 if out.frame["motion"]["still"] else 1

        if t >= self._next_vitals:
            self._next_vitals += 1.0
            v = self.src.vitals()
            if acc:
                if v["hr"]["bpm"] and not v["hr"]["frozen"]:
                    acc.hr.append(v["hr"]["bpm"])
                # >= 15 s: ultra-short RMSSD is usable from ~10 s (Munoz et al. 2015); rests last 20 s.
                if v["hrv"]["rmssd_ms"] and v["hrv"]["window_s"] >= 15:
                    acc.rmssd.append(v["hrv"]["rmssd_ms"])
                if v["resp"]["rate_bpm"]:
                    acc.resp.append(v["resp"]["rate_bpm"])
                acc.resonance.append(v["resonance"]["score"])
                if "phase_lock" in v:
                    acc.phase_lock = v["phase_lock"]["value"]
            vs = self._vs_baseline(v)
            if vs:
                v["vs_baseline"] = vs
            msgs.append(dict(type="vitals", **v))
            tl = self.timeline
            tl["t"].append(round(t)); tl["phase"].append(self.phase)
            tl["hr_bpm"].append(v["hr"]["bpm"]); tl["breath_signal"].append(out.frame["breath"]["signal"])
            tl["resonance_score"].append(v["resonance"]["score"]); tl["motion_level"].append(out.frame["motion"]["level"])

        if t >= self._next_quality:
            setup = self.phase is None and self.status == "setup"
            self._next_quality += 1.0 if setup else 5.0
            self.last_quality = dict(type="quality", **self.src.quality(setup))
            msgs.append(self.last_quality)

        if t >= self._next_channels:                       # brain map, 2x per second
            self._next_channels += 0.5
            ch = self.src.channels()
            if ch:
                msgs.append(dict(type="channels", **ch))

        if out.phase_finished and self.phase:
            self._finish_phase()
        msgs += self.outbox
        self.outbox = []
        return msgs

    def _vs_baseline(self, v: dict) -> dict | None:
        pre = self.phases.get("baseline_pre")
        if not pre or self.phase == "baseline_pre" or not pre.hr:
            return None
        out = {}
        if v["hr"]["bpm"]:
            out["hr_delta_bpm"] = round(v["hr"]["bpm"] - M.mean(pre.hr), 1)
        if v["hrv"]["rmssd_ms"] and pre.rmssd:
            out["rmssd_delta_pct"] = round(100 * (v["hrv"]["rmssd_ms"] / pre.rmssd[-1] - 1))
        return out or None

    # ------------------------------------------------------------------ finish
    def finish(self) -> dict:
        if self.phase:
            self._finish_phase()
        self.src.stop_phase()
        self.ended = True
        self.status = "finished"
        summary, rows = build_summary(self)
        path = config.TIMELINES / f"{self.id}.json"
        path.write_text(json.dumps(dict(
            session_id=self.id, step_s=1, phases=self.phase_log, series=self.timeline,
            events=[{k: v for k, v in e.items() if v is not None} for e in self.events],
            sources={k: self.kind for k in self.timeline if k not in ("t", "phase")},
        ), ensure_ascii=False), encoding="utf-8")
        with db.get_conn() as conn:
            repo.finish_session(conn, self.id, self.user_id, summary, rows, str(path))
        return summary


# key: session id -> live state (in memory; lost on restart, fine for the demo)
sessions: dict[str, LiveSession] = {}
baseline_opts: dict[str, float] = {}


# ---------------------------------------------------------------------- summary

def _r(x, nd=1):
    return round(x, nd) if x is not None else None


def build_summary(s: LiveSession) -> tuple[dict, list[dict]]:
    """Summary JSON (APP_SPEC 4.10) + metric rows (APP_SPEC 7.3)."""
    src = s.kind                                         # "real" for replay, "simulated" for mock
    sim_ex = s.exercise in ("movement", "hr_recovery")   # no data for these -> always simulated
    ex_src = "simulated" if sim_ex else src
    P = s.phases

    def stats(name):
        a = P.get(name)
        if not a:
            return None
        return dict(hr_bpm=_r(M.mean(a.hr)), rmssd_ms=_r(a.rmssd[-1] if a.rmssd else None),
                    resp_rate_bpm=_r(M.mean(a.resp)))

    before, after = stats("baseline_pre"), stats("baseline_post")
    delta = None
    if before and after:
        delta = dict(
            hr_bpm=_r(after["hr_bpm"] - before["hr_bpm"]) if after["hr_bpm"] and before["hr_bpm"] else None,
            rmssd_pct=_r(100 * (after["rmssd_ms"] / before["rmssd_ms"] - 1), 0)
            if after["rmssd_ms"] and before["rmssd_ms"] else None,
            resp_rate_bpm=_r(after["resp_rate_bpm"] - before["resp_rate_bpm"])
            if after["resp_rate_bpm"] and before["resp_rate_bpm"] else None)

    exa = P.get(s.exercise)
    scores: dict = {}
    exercise_hr = None
    if exa:
        exercise_hr = _r(M.mean(exa.hr))
        if s.exercise == "resonance_breathing" and exa.resonance:
            top = sorted(exa.resonance)[len(exa.resonance) // 2:]          # upper half = paced parts
            scores["resonance"] = round(M.mean(top))
            scores["phase_lock"] = exa.phase_lock
    if delta and delta.get("hr_bpm") is not None:
        rel = 50 - 5 * delta["hr_bpm"] + 0.5 * (delta.get("rmssd_pct") or 0) + 0.2 * (scores.get("resonance", 50) - 50)
        scores["relaxation"] = round(max(0, min(100, rel)))

    holds = [dict(t=e["t"], hold_s=e["data"]["hold_s"], by=e["data"]["by"],
                  hbo_rise_uM=e["data"]["hbo_rise_uM"], confidence=e["confidence"])
             for e in s.events if e["name"] == "hold_end_detected"]
    moves = [e for e in s.events if e["name"] in ("command_verified", "command_failed")]
    recovery = next((e["data"] for e in s.events if e["name"] == "recovery_measured"), None)

    frames = sum(a.frames for a in P.values())
    unstill = sum(a.unstill for a in P.values())
    quality = dict(good_pct=(s.last_quality or {}).get("good_pct"), motion_s=round(unstill * TICK_S, 1),
                   measured_s=round(frames * TICK_S, 1))

    u = s.user or {}
    d = u.get("derived") or {}
    crf = M.crf_jurca(u.get("sex"), d.get("age"), d.get("bmi"),
                      before["hr_bpm"] if before else None, u.get("activity_score"))

    ins = []
    if delta and delta.get("hr_bpm") is not None:
        if delta["hr_bpm"] <= -2:
            txt = f"Po ćwiczeniu tętno spadło o {abs(delta['hr_bpm']):.0f} BPM"
            if delta.get("rmssd_pct") and delta["rmssd_pct"] > 5:
                txt += f", a HRV wzrosło o {delta['rmssd_pct']:.0f}%"
            ins.append(dict(kind="positive", text=txt + " – dobra relaksacja."))
        elif delta["hr_bpm"] >= 3:
            ins.append(dict(kind="info", text=f"Tętno po ćwiczeniu jest wyższe o {delta['hr_bpm']:.0f} BPM. "
                                              "Daj sobie chwilę spokojnego oddechu."))
        else:
            ins.append(dict(kind="info", text="Tętno przed i po ćwiczeniu jest podobne."))
    if scores.get("phase_lock") is not None:
        pl = scores["phase_lock"]
        ins.append(dict(kind="positive" if pl >= 0.7 else "tip",
                        text=f"Zgodność z rytmem: {pl * 100:.0f}%." +
                             ("" if pl >= 0.7 else " Spróbuj płynniej podążać za kulą.")))
    if holds:
        ins.append(dict(kind="info", text=f"Najdłuższy bezdech w tej sesji: {max(h['hold_s'] for h in holds):.0f} s."))
    for m in moves:
        dd = m["data"]
        ins.append(dict(kind="positive" if m["name"] == "command_verified" else "tip",
                        text=f"Ruch „{dd['target']}”: wykryto {dd['detected_reps']}/{dd['reps']} powtórzeń."))
    if quality["measured_s"] and quality["motion_s"] > 0.2 * quality["measured_s"]:
        ins.append(dict(kind="tip", text="Sporo ruchu w trakcie pomiaru – wyniki mogą być mniej dokładne."))
    if src == "real" and after:
        ins.append(dict(kind="info", text="Dane z prawdziwego nagrania. Pomiar „po” pochodzi z dalszej części "
                                          "spoczynku sprzed ćwiczenia (w zbiorze brak pomiaru po ćwiczeniu)."))

    summary = dict(
        session_id=s.id, exercise=s.exercise, duration_s=round(s.src.t, 1), phases=s.phase_log,
        before=before, after=after, delta=delta,
        exercise_stats=dict(hr_bpm=exercise_hr) if exa else None,
        scores=scores or None, holds=holds,
        movement=[dict(target=m["data"]["target"], reps=m["data"]["reps"],
                       detected_reps=m["data"]["detected_reps"], verified=m["name"] == "command_verified")
                  for m in moves],
        recovery=dict(recovery, source="simulated") if recovery else None,
        crf_mets=_r(crf), quality=quality, insights=ins,
        # where "after" comes from: live / exercise_end (SPB post rest) / rest_recording (later part of the rest file)
        after_from=getattr(s.src, "post_from", "live") if after else None,
        sources=dict(hr=src, hrv=src, resp=src, resonance=ex_src, holds=ex_src,
                     movement="simulated", recovery="simulated"),
    )

    rows = []
    def add(name, phase, value, conf=None, source=None):
        if value is not None:
            rows.append(dict(name=name, phase=phase, value=value, confidence=conf,
                             source=source or (ex_src if phase == "exercise" else src)))
    for ph, st in (("before", before), ("after", after)):
        if st:
            add("hr_bpm", ph, st["hr_bpm"]); add("rmssd_ms", ph, st["rmssd_ms"])
            add("resp_rate_bpm", ph, st["resp_rate_bpm"], 0.5)
    add("hr_bpm", "exercise", exercise_hr)
    add("resonance_score", "exercise", scores.get("resonance"))
    add("phase_lock", "exercise", scores.get("phase_lock"))
    add("relaxation_score", "session", scores.get("relaxation"))
    if holds:
        add("hold_s", "exercise", max(h["hold_s"] for h in holds))
        add("hold_hbo_peak_uM", "exercise", max(h["hbo_rise_uM"] for h in holds))
    if moves:
        add("reps_verified", "exercise", sum(m["data"]["detected_reps"] for m in moves if m["name"] == "command_verified"),
            source="simulated")
    if recovery:
        add("hr_recovery_drop_bpm", "after", recovery["drop_1min_bpm"], source="simulated")
    add("good_pct", "session", quality["good_pct"])
    add("motion_s", "session", quality["motion_s"])
    add("crf_mets", "session", _r(crf))
    return summary, rows
