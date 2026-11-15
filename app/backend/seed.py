"""Demo personas built from REAL recordings (APP_SPEC 7.6).

Uses the feature tables produced by scripts/01_extract_features.py:
  results/subjects.csv, results/features.csv, results/holds_supine.csv
DOT subject -> persona with 4 resonance-breathing sessions (RS -> SPB) + 2 short-hold sessions,
timestamped with the real measurement clock times (so the day-rhythm view is real).
Supine subject -> persona with one breath-hold session (known hold ends).
"""
from __future__ import annotations

import math
from datetime import datetime

import pandas as pd

from . import config, repo
from . import metrics as M

HAIR = {"none": "none", "grey": "grey", "blonde": "blonde", "brown": "brown", "black/red": "black"}


def _num(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else float(x)


def _ts(date, time_) -> str:
    return f"{date}T{str(time_)[:8]}"


def available() -> bool:
    return all((config.RESULTS / f).exists() for f in ("subjects.csv", "features.csv", "holds_supine.csv"))


def _profile(s: pd.Series, label: str) -> dict:
    return dict(name=label, birth_year=datetime.now().year - int(s.age), sex=s.sex,
                height_cm=_num(s.height_cm), weight_kg=_num(s.weight_kg), activity_score=_num(s.activity),
                avatar=dict(hair_color=HAIR.get(s.hair_color_name), skin_tone=int(s.fitzpatrick)
                            if not pd.isna(s.fitzpatrick) else None))


def _summary(sid, exercise, before, exercise_stats, scores, holds, crf, good_pct, note):
    return dict(session_id=sid, exercise=exercise, duration_s=None, phases=[], before=before, after=None,
                delta=None, exercise_stats=exercise_stats, scores=scores, holds=holds,
                recovery=None, crf_mets=crf, quality=dict(good_pct=good_pct, motion_s=None, measured_s=None),
                insights=[dict(kind="info", text=note)],
                sources=dict(hr="real", hrv="real", resp="real", resonance="real", holds="real"))


def seed(conn) -> dict:
    if not available():
        return dict(seeded=False, reason="results/*.csv missing - run scripts/01_extract_features.py")
    subj = pd.read_csv(config.RESULTS / "subjects.csv")
    fe = pd.read_csv(config.RESULTS / "features.csv")
    holds = pd.read_csv(config.RESULTS / "holds_supine.csv")
    n_users = n_sessions = 0

    # ---------------------------------------------------------------- DOT personas
    for _, s in subj[subj.dataset == "dot"].iterrows():
        sid_ = int(s.subject)
        uid = f"demo_dot_{sid_:02d}"
        user = repo.create_user(conn, _profile(s, f"Persona DOT {sid_:02d}"), user_id=uid,
                                is_demo=True, persona_source=f"dot/{sid_:02d}")
        n_users += 1
        f = fe[(fe.dataset == "dot") & (fe.subject == sid_)]
        age, bmi = user["derived"]["age"], user["derived"]["bmi"]
        for k in range(1, 5):
            rs = f[(f.task == "RS") & (f.session == k)]
            spb = f[(f.task == "SPB") & (f.session == k)]
            if rs.empty or spb.empty:
                continue
            rs, spb = rs.iloc[0], spb.iloc[0]
            sess_id = f"demo_dot_{sid_:02d}_rsb{k}"
            hr0 = _num(rs.hr_beats)
            res = round(M.resonance_score(spb.rel_mayer, rs.rel_mayer))
            lock = round(float(spb.spb_phase_locking), 2)
            crf = M.crf_jurca(s.sex, age, bmi, hr0, _num(s.activity))
            before = dict(hr_bpm=round(hr0, 1), rmssd_ms=round(_num(rs.rmssd_ms), 1),
                          resp_rate_bpm=round(_num(rs.resp_rate_bpm), 1))
            repo.create_session(conn, user_id=uid, source_type="replay", exercise="resonance_breathing",
                                recording_id=f"dot/{sid_:02d}/SPB{k}", session_id=sess_id,
                                protocol=["baseline_pre", "resonance_breathing"],
                                started_at=_ts(rs.meas_date, rs.meas_time), is_demo=True)
            summary = _summary(sess_id, "resonance_breathing", before,
                               dict(hr_bpm=round(_num(spb.hr_beats), 1)),
                               dict(resonance=res, phase_lock=lock), [], round(crf, 1) if crf else None,
                               round(_num(spb.good_pct), 1),
                               "Session from a recording (DOT dataset). The data has no resting measurement after the exercise.")
            rows = [dict(name="hr_bpm", phase="before", value=hr0, source="real"),
                    dict(name="rmssd_ms", phase="before", value=_num(rs.rmssd_ms), source="real"),
                    dict(name="resp_rate_bpm", phase="before", value=_num(rs.resp_rate_bpm), source="real", confidence=0.5),
                    dict(name="hr_bpm", phase="exercise", value=_num(spb.hr_beats), source="real"),
                    dict(name="resonance_score", phase="exercise", value=res, source="real"),
                    dict(name="phase_lock", phase="exercise", value=lock, source="real"),
                    dict(name="good_pct", phase="session", value=_num(spb.good_pct), source="real"),
                    dict(name="crf_mets", phase="session", value=crf, source="real")]
            repo.finish_session(conn, sess_id, uid, summary, rows, None,
                                finished_at=_ts(spb.meas_date, spb.meas_time))
            n_sessions += 1
        for k in (1, 2):
            bh = f[(f.task == "BH") & (f.session == k)]
            if bh.empty:
                continue
            bh = bh.iloc[0]
            sess_id = f"demo_dot_{sid_:02d}_bh{k}"
            peak = _num(bh.short_hold_hbo_peak)
            repo.create_session(conn, user_id=uid, source_type="replay", exercise="short_holds",
                                recording_id=f"dot/{sid_:02d}/BH{k}", session_id=sess_id,
                                protocol=["short_holds"], started_at=_ts(bh.meas_date, bh.meas_time), is_demo=True)
            summary = _summary(sess_id, "short_holds", None, dict(hr_bpm=round(_num(bh.hr_beats), 1)),
                               None, [dict(kind="short", hbo_rise_uM=round(peak, 3) if peak else None)], None,
                               round(_num(bh.good_pct), 1), "7 short breath holds from a recording (DOT dataset).")
            repo.finish_session(conn, sess_id, uid, summary,
                                [dict(name="hold_hbo_peak_uM", phase="exercise", value=peak, source="real"),
                                 dict(name="hr_bpm", phase="exercise", value=_num(bh.hr_beats), source="real")],
                                None, finished_at=_ts(bh.meas_date, bh.meas_time))
            n_sessions += 1

    # ---------------------------------------------------------------- supine personas
    for _, s in subj[subj.dataset == "supine"].iterrows():
        sid_ = int(s.subject)
        f = fe[(fe.dataset == "supine") & (fe.subject == sid_)]
        bh, bs = f[f.task == "BH"], f[f.task == "BS"]
        if bh.empty:
            continue
        uid = f"demo_sup_{sid_:02d}"
        user = repo.create_user(conn, _profile(s, f"Persona supine {sid_:02d}"), user_id=uid,
                                is_demo=True, persona_source=f"supine/{sid_:02d}")
        n_users += 1
        bh = bh.iloc[0]
        h = holds[(holds.subject == sid_) & holds.duration_s.notna()]
        hr0 = _num(bs.iloc[0].hr_beats) if not bs.empty else None
        crf = M.crf_jurca(s.sex, user["derived"]["age"], user["derived"]["bmi"], hr0, _num(s.activity))
        sess_id = f"demo_sup_{sid_:02d}_bh"
        hold_list = [dict(kind="max", hold_s=round(r.duration_s, 1), by="marker") for r in h.itertuples()]
        before = dict(hr_bpm=round(hr0, 1), rmssd_ms=round(_num(bs.iloc[0].rmssd_ms), 1),
                      resp_rate_bpm=round(_num(bs.iloc[0].resp_rate_bpm), 1)) if hr0 else None
        repo.create_session(conn, user_id=uid, source_type="replay", exercise="breath_hold",
                            recording_id=f"supine/{sid_}/BH", session_id=sess_id,
                            protocol=["baseline_pre", "breath_hold"],
                            started_at=_ts(bh.meas_date, bh.meas_time), is_demo=True)
        summary = _summary(sess_id, "breath_hold", before, dict(hr_bpm=round(_num(bh.hr_beats), 1)), None,
                           hold_list, round(crf, 1) if crf else None, round(_num(bh.good_pct), 1),
                           "Breath holds from a recording (supine dataset); durations from the markers.")
        rows = [dict(name="hold_hbo_peak_uM", phase="exercise", value=_num(bh.hold_hbo_peak), source="real"),
                dict(name="crf_mets", phase="session", value=crf, source="real")]
        if len(h):
            rows.append(dict(name="hold_s", phase="exercise", value=float(h.duration_s.max()), source="real"))
        if before:
            rows += [dict(name="hr_bpm", phase="before", value=hr0, source="real"),
                     dict(name="rmssd_ms", phase="before", value=before["rmssd_ms"], source="real")]
        repo.finish_session(conn, sess_id, uid, summary, rows, None)
        n_sessions += 1

    return dict(seeded=True, users=n_users, sessions=n_sessions)


def reset(conn) -> dict:
    removed = repo.delete_demo(conn)
    return dict(removed_users=removed, **seed(conn))
