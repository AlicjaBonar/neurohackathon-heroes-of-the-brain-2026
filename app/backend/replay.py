"""Replay source: plays real SNIRF recordings through the same interface as MockSource.

Each recording is processed once (cached): good long channels -> HbO/HbR -> respiratory
signal and phase, heartbeats, motion level, channel quality; everything resampled to the
10 Hz frame grid. Playback then just walks through these arrays. Filters are zero-phase
(computed on the whole file) - fine for a demo, a live device would lag by ~1-2 s.

Phase -> recording of the same person (APP_SPEC 5):
  baseline_pre      DOT RS{n} from 0 s           | supine BS from 0 s
  baseline_post     DOT RS{n} from 300 s         | supine BS from 300 s   (no real "after" in the data)
  resonance_breathing  DOT SPB{n} (pacer + cycles from markers 21-28)
  short_holds       DOT BH1 until the first maximal-hold block (markers 71/72)
  breath_hold       supine BH first hold (end from marker 1) | DOT BH1 first maximal hold (end by detector)
  movement, hr_recovery  -> delegated to MockSource (no such data), flagged simulated
"""
from __future__ import annotations

import re
import sys
from functools import lru_cache

import h5py
import numpy as np
from scipy import signal as ss

from . import config
from . import metrics as M
from .mock_source import MockSource, StepOut

sys.path.insert(0, str(config.ROOT / "src"))
from hob import pipeline as P  # noqa: E402
from hob import signal as S  # noqa: E402
from hob.io import list_files, load_snirf  # noqa: E402

FS_OUT = 10.0
SRC = "real"
SAT_LEVEL = 4.9            # detector ceiling ~4.99 (EDA)
POST_OFFSET_S = 300.0
MOCK_PHASES = ("movement", "hr_recovery")


class RecordingNotFound(Exception):
    pass


# ----------------------------------------------------------------------------- recording ids

@lru_cache(maxsize=1)
def _files():
    return list_files()


def parse_id(rec_id: str) -> tuple[str, int, int]:
    """'dot/03', 'dot/03/SPB2', 'supine/10', 'supine/10/BH' -> (dataset, subject, session)."""
    m = re.fullmatch(r"(dot|supine)/(\d+)(?:/([A-Z]+)(\d)?)?", (rec_id or "").strip())
    if not m:
        raise RecordingNotFound(f"Bad recording id {rec_id!r}; use e.g. 'dot/03' or 'supine/10'")
    return m[1], int(m[2]), int(m[4]) if m[4] else 1


def _path(dataset: str, subject: int, task: str, session: int = 1):
    f = _files()
    r = f[(f.dataset == dataset) & (f.subject == subject) & (f.task == task) & (f.session == session)]
    return r.path.iloc[0] if len(r) else None


def available_phases(rec_id: str) -> set[str]:
    ds, sub, sess = parse_id(rec_id)
    out = set(MOCK_PHASES)
    if ds == "dot":
        if _path(ds, sub, "RS", sess):
            out |= {"baseline_pre", "baseline_post"}
        if _path(ds, sub, "SPB", sess):
            out.add("resonance_breathing")
        if _path(ds, sub, "BH", 1):
            out |= {"short_holds", "breath_hold"}
    else:
        if _path(ds, sub, "BS"):
            out |= {"baseline_pre", "baseline_post"}
        if _path(ds, sub, "BH"):
            out.add("breath_hold")
    if out == set(MOCK_PHASES):
        raise RecordingNotFound(f"No recordings for {rec_id}")
    return out


# ----------------------------------------------------------------------------- processing

class Prepared:
    """One recording processed for playback (arrays on the 10 Hz grid)."""

    def __init__(self, path, age: float | None):
        rec = load_snirf(path)
        fs, n = rec.fs, rec.intensity.shape[0]
        pt = rec.pair_table()
        i760, i850 = rec.wl(760), rec.wl(850)
        if rec.missing is not None:
            i760 = np.where(rec.missing[:, None], np.nan, i760)
            i850 = np.where(rec.missing[:, None], np.nan, i850)
        H = P.hemo(rec, age=age)                 # MNE: OD -> SCI -> TDDR -> Beer-Lambert
        sci = H.sci
        mean760, mean850 = np.nanmean(i760, 0), np.nanmean(i850, 0)
        p99 = np.maximum(np.nanpercentile(i760, 99, 0), np.nanpercentile(i850, 99, 0))
        flat = np.maximum(S.flatline_fraction(np.nan_to_num(i760)), S.flatline_fraction(np.nan_to_num(i850)))
        dist = pt.distance_mm.to_numpy()
        long_ = dist >= 15
        status = np.where((mean760 <= 0.01) | (mean850 <= 0.01), "dark",
                 np.where(p99 >= SAT_LEVEL, "saturated", np.where((sci >= 0.7) & (flat < 0.2), "good", "weak")))
        good = (status == "good") & long_
        if good.sum() == 0:
            good = long_
        self.channels = [dict(pair=p, status=str(s), sci=round(float(c), 3), distance_mm=round(float(d), 1))
                         for p, s, c, d in zip(rec.pairs, status, sci, dist)]
        self.good_pct = round(100.0 * (status[long_] == "good").mean(), 1)
        self.sci_median = round(float(np.median(sci[long_])), 3)

        hbo, hbr = H.hbo, H.hbr
        hbo_m = S.bandpass(hbo[:, good], fs, 0.005, 0.5).mean(1)
        hbr_m = S.bandpass(hbr[:, good], fs, 0.005, 0.5).mean(1)
        breath = S.bandpass(hbo[:, good], fs, 0.05, 0.6).mean(1)
        slow = S.bandpass(hbo[:, good], fs, 0.005, 0.6).mean(1)     # for spectra (resonance, resp rate)

        # heartbeats: NeuroKit2 (ppg_clean + Elgendi peaks with artifact correction)
        self.beats = P.beats(hbo, fs, good)

        # motion level 0..1 from the accelerometer
        acc, _ = S.split_aux(rec.aux)
        if acc is not None:
            mag = np.linalg.norm(S.bandpass(acc, fs, 0.1, None, 2), axis=1)
            mag = np.convolve(mag, np.ones(int(fs // 2)) / int(fs // 2), mode="same")
            p50, p995 = np.percentile(mag, 50), np.percentile(mag, 99.5)
            motion = np.clip((mag - p50) / (p995 - p50 + 1e-12) * 0.6, 0, 1)
        else:
            motion = np.zeros(n)

        # resample to the 10 Hz frame grid
        t_in = np.arange(n) / fs
        self.duration = n / fs
        self.t = np.arange(0, self.duration, 1 / FS_OUT)
        rs = lambda x: np.interp(self.t, t_in, x)  # noqa: E731
        self.hbo, self.hbr, self.slow, self.motion = rs(hbo_m), rs(hbr_m), rs(slow), rs(motion)
        b = rs(breath)
        self.breath = b / (np.std(b) + 1e-12)
        theta = np.angle(ss.hilbert(self.breath))           # HbO minimum -> theta = pi -> phase 0.2
        self.phase = (theta / (2 * np.pi) - 0.5 + 0.2) % 1.0
        self.events = rec.events.assign(code=rec.events.code.astype(str).str.strip())
        self.probe = _probe(rec, path)

        # brain map: per-pair HbO/HbR on the 10 Hz grid (order = probe["pairs"]); bad channels -> NaN
        idx = np.minimum((self.t * fs).astype(int), n - 1)
        valid = status == "good"
        self.map_hbo = S.bandpass(hbo, fs, 0.005, 0.3)[idx].astype(np.float32)
        self.map_hbr = S.bandpass(hbr, fs, 0.005, 0.3)[idx].astype(np.float32)
        self.map_hbo[:, ~valid] = np.nan
        self.map_hbr[:, ~valid] = np.nan
        vals = np.abs(self.map_hbo[:, valid])
        self.map_scale = round(float(np.nanpercentile(vals, 95)), 3) if vals.size else 1.0

    def idx(self, pos: float) -> int:
        return int(min(max(pos * FS_OUT, 0), len(self.t) - 1))

    def window(self, x, pos: float, win: float):
        i1 = self.idx(pos) + 1
        return x[max(0, i1 - int(win * FS_OUT)):i1]

    def markers(self, codes) -> np.ndarray:
        return self.events.onset[self.events.code.isin(codes)].to_numpy()


CORTEX_DEPTH_MM = 15.0     # fNIRS is most sensitive ~1-2 cm below the scalp (infopack)
MAP_LANDMARKS = ("Nz", "Fpz", "Fp1", "Fp2", "AF7", "AF3", "AFz", "AF4", "AF8",
                 "F7", "F3", "Fz", "F4", "F8", "FC5", "FC1", "FCz", "FC2", "FC6", "Cz", "T7", "T8")


def _probe(rec, path) -> dict:
    """Optode layout for a top-down head map: SNIRF 2D positions centred on Cz and scaled so that
    the head radius (Cz -> Nz) is 1; x to the right, y towards the nose. Each pair gets the midpoint
    between its source and detector and the nearest 10-10 label."""
    with h5py.File(path, "r") as h:
        pr = h["nirs/probe"]
        src2, det2 = pr["sourcePos2D"][()][:, :2], pr["detectorPos2D"][()][:, :2]
        lm2 = pr["landmarkPos2D"][()][:, :2]
        src3, det3, lm3 = pr["sourcePos3D"][()][:, :3], pr["detectorPos3D"][()][:, :3], pr["landmarkPos3D"][()][:, :3]
        labels = [x.decode() if isinstance(x, bytes) else str(x) for x in pr["landmarkLabels"][()]]
    lm = dict(zip(labels, lm2))
    centre = lm.get("Cz", np.zeros(2))
    radius = float(np.linalg.norm(lm["Nz"] - centre)) if "Nz" in lm else float(np.abs(lm2).max())
    norm = lambda p: (np.asarray(p) - centre) / radius  # noqa: E731
    r3 = lambda v: round(float(v), 3)  # noqa: E731
    lm_names = [k for k in labels if k in lm]
    lm_xy = np.array([norm(lm[k]) for k in lm_names])
    # 3D head frame [mm]: x right, y nose, z up; origin = midpoint T7-T8 (scalp ~ sphere around it)
    lm3d = dict(zip(labels, lm3))
    c3 = (lm3d["T7"] + lm3d["T8"]) / 2 if "T7" in lm3d and "T8" in lm3d else lm3.mean(0)
    v3 = lambda q: [round(float(v), 1) for v in (np.asarray(q) - c3)]  # noqa: E731
    pt = rec.pair_table()
    pairs = []
    for p, r in pt.iterrows():
        mid = (norm(src2[int(r.source) - 1]) + norm(det2[int(r.detector) - 1])) / 2
        near = lm_names[int(np.argmin(np.linalg.norm(lm_xy - mid, axis=1)))]
        m3 = (src3[int(r.source) - 1] + det3[int(r.detector) - 1]) / 2 - c3
        nrm = m3 / (np.linalg.norm(m3) + 1e-9)
        pairs.append(dict(index=len(pairs), pair=p, source=int(r.source), detector=int(r.detector),
                          distance_mm=round(float(r.distance_mm), 1), short=bool(r.distance_mm < 15),
                          x=r3(mid[0]), y=r3(mid[1]), label=near,
                          pos3d=[round(float(v), 1) for v in m3], normal=[r3(v) for v in nrm],
                          cortex3d=[round(float(v), 1) for v in m3 - CORTEX_DEPTH_MM * nrm]))
    return dict(montage="dot_frontal" if len(rec.pairs) > 20 else "sparse_prefrontal",
                coords="head_unit_circle", orientation="x: right, y: nose; Cz = (0, 0), head radius = 1",
                sources=[dict(id=i + 1, x=r3(norm(q)[0]), y=r3(norm(q)[1]), pos3d=v3(src3[i])) for i, q in enumerate(src2)],
                detectors=[dict(id=i + 1, x=r3(norm(q)[0]), y=r3(norm(q)[1]), pos3d=v3(det3[i])) for i, q in enumerate(det2)],
                landmarks=[dict(label=k, x=r3(norm(lm[k])[0]), y=r3(norm(lm[k])[1]), pos3d=v3(lm3d[k]))
                           for k in MAP_LANDMARKS if k in lm],
                head3d=_head3d(labels, lm3, c3),
                pairs=pairs)


def _head3d(labels, lm3, c3) -> dict:
    """All 10-10 points (enough to build a head mesh, e.g. convex hull) + an ellipsoid fit."""
    pts = lm3 - c3
    up = pts[pts[:, 2] > -30]
    radii = [round(float(np.abs(up[:, 0]).max()), 1), round(float(np.abs(up[:, 1]).max()), 1),
             round(float(up[:, 2].max()), 1)]
    return dict(units="mm", frame="x: right, y: nose, z: up; origin = midpoint T7-T8",
                ellipsoid_radii_mm=radii, cortex_depth_mm=CORTEX_DEPTH_MM,
                points=[dict(label=l, pos3d=[round(float(v), 1) for v in q]) for l, q in zip(labels, pts)])


@lru_cache(maxsize=12)
def prepare(path_str: str, age: float | None) -> Prepared:
    from pathlib import Path
    return Prepared(Path(path_str), age)


def _rel_power(x: np.ndarray) -> float | None:
    """Share of 0.07-0.13 Hz power in 0.01-0.6 Hz (10 Hz signal)."""
    if len(x) < 30 * FS_OUT:
        return None
    f, p = ss.welch(x - x.mean(), fs=FS_OUT, nperseg=min(len(x), int(60 * FS_OUT)), detrend="linear")
    tot = S.band_power(f, p, (0.01, 0.6))
    return float(S.band_power(f, p, (0.07, 0.13)) / tot) if tot > 0 else None


# ----------------------------------------------------------------------------- source

class ReplaySource:
    fs_hz = FS_OUT

    def __init__(self, rec_id: str, age: float | None, baseline_s: float = 120.0):
        self.ds, self.sub, self.sess = parse_id(rec_id)
        self.rec_id, self.age, self.baseline_s = rec_id, age, baseline_s
        self.available = available_phases(rec_id)
        base_task = "RS" if self.ds == "dot" else "BS"
        self.base = self._prep(base_task, self.sess)
        self.n_pairs = len(self.base.channels)
        self.montage = self.base.probe["montage"]
        # resonance reference: whole resting recording of the same person
        self.res_base = _rel_power(self.base.slow) or M.MAYER_REL_REST
        self.res_span = 0.15
        self.t = 0.0
        self.cur, self.pos, self.end, self.loop = self.base, 0.0, self.base.duration, True
        self.phase_name: str | None = None
        self.mode = "replay"
        self.mock: MockSource | None = None
        self.sched: list[tuple[float, dict]] = []
        self.cycle_marks: np.ndarray = np.array([])
        self.cycles = 0
        self.hold_open = False
        self.last_unstill = -99.0
        self.last_warn = -99.0
        self._last_hr = None
        self._last_ibi = None

    def _prep(self, task: str, session: int = 1) -> Prepared:
        p = _path(self.ds, self.sub, task, session if self.ds == "dot" else 1)
        if p is None:
            raise RecordingNotFound(f"{self.ds}/{self.sub:02d} has no {task}{session}")
        return prepare(str(p), self.age)

    # ------------------------------------------------------------------ phases
    def start_phase(self, name: str) -> float:
        if name not in self.available:
            raise RecordingNotFound(f"Phase {name} is not available for {self.rec_id}")
        self.phase_name, self.sched, self.cycles, self.hold_open = name, [], 0, False
        self.cycle_marks = np.array([])
        if name in MOCK_PHASES:
            self.mode = "mock"
            self.mock = MockSource(baseline_s=self.baseline_s)
            self.mock.t = self.t
            if self._last_hr:
                self.mock.hr_base = self._last_hr
            return self.mock.start_phase(name)
        self.mode, self.loop = "replay", False
        dot = self.ds == "dot"
        if name in ("baseline_pre", "baseline_post"):
            r = self.base
            start = 0.0 if name == "baseline_pre" else min(POST_OFFSET_S, max(0.0, r.duration - self.baseline_s))
            self._play(r, start, min(r.duration, start + self.baseline_s))
        elif name == "resonance_breathing":
            r = self._prep("SPB", self.sess)
            self._play(r, 0.0, r.duration)
            self.cycle_marks = np.sort(r.markers(["21", "23", "25", "27"]))
            for k, on in enumerate(self.cycle_marks, 1):
                self.sched.append((on, dict(name="cycle", data=dict(index=k, set=(k - 1) // 5 + 1, in_set=(k - 1) % 5 + 1))))
        elif name == "short_holds":
            r = self._prep("BH", 1)
            first_max = r.markers(["73", "77"])
            end = float(first_max.min()) if len(first_max) else r.duration
            self._play(r, 0.0, end)
            for on in r.markers(["72", "76"]):
                if on + 10 < end:
                    self._sched_hold(r, on, on + 10.0, "short", "marker", 1.0, dict(target_s=10))
        elif name == "breath_hold":
            if dot:
                r = self._prep("BH", 1)
                ons = np.sort(r.markers(["74", "78"]))
                on = float(ons[0])
                # the 2nd maximal hold follows ~1 min of free breathing -> the 1st must end >= 45 s before it
                limit = float(ons[1]) - 45.0 if len(ons) > 1 else None
                end, conf = self._detect_hold_end(r, on, limit), 0.5
                by = "detector"
            else:
                r = self._prep("BH")
                on = float(np.sort(r.markers(["2"]))[0])
                nxt = r.markers(["1"])
                nxt = nxt[nxt > on]
                end, conf, by = (float(nxt.min()), 1.0, "marker") if len(nxt) else (self._detect_hold_end(r, on), 0.6, "detector")
            start = max(0.0, on - 30.0)
            self._play(r, start, min(r.duration, end + 45.0))
            self._sched_hold(r, on, end, "max", by, conf)
        self.sched.sort(key=lambda x: x[0])
        return round(self.end - self.pos, 1)

    def _play(self, r: Prepared, start: float, end: float) -> None:
        self.cur, self.pos, self.end = r, start, end

    def _sched_hold(self, r, on, end, kind, by, conf, extra=None):
        i0, i1 = r.idx(on), r.idx(min(end + 15, r.duration))
        rise = float(r.hbo[i0:i1].max() - r.hbo[i0]) if i1 > i0 else 0.0
        self.sched.append((on, dict(name="hold_start", data=dict(kind=kind, **(extra or {})))))
        self.sched.append((end, dict(name="hold_end_detected", confidence=conf,
                                     data=dict(hold_s=round(end - on, 1), by=by, hbo_rise_uM=round(rise, 3)))))

    @staticmethod
    def _detect_hold_end(r: Prepared, on: float, limit: float | None = None) -> float:
        """Simple detector: HbO+HbR rise through the hold and peak when breathing resumes (EDA)."""
        hi = min(on + 110, r.duration - 1, limit if limit and limit > on + 15 else 1e9)
        a, b = r.idx(on + 8), r.idx(hi)
        x = np.convolve(r.hbo + r.hbr, np.ones(20) / 20, mode="same")
        return float(r.t[a + int(np.argmax(x[a:b]))]) if b > a else on + 30

    def stop_phase(self) -> None:
        self.phase_name, self.mode, self.sched = None, "replay", []
        self._play(self.base, 0.0, self.base.duration)
        self.loop = True

    # ------------------------------------------------------------------ user actions
    def user_event(self, name: str) -> bool:
        if name == "hold_end_button" and self.hold_open:
            self.hold_open = False
            hs = [p for p, e in self.sched if e["name"] == "hold_start" and p <= self.pos]
            self.sched = [(p, e) for p, e in self.sched if not (e["name"] == "hold_end_detected" and p > self.pos)]
            self._pending_btn = dict(name="hold_end_detected", confidence=1.0,
                                     data=dict(hold_s=round(self.pos - (hs[-1] if hs else self.pos), 1),
                                               by="button", hbo_rise_uM=0.0))
            return True
        if self.mode == "mock" and self.mock:
            return self.mock.user_event(name)
        return False

    def simulate_motion(self, gesture, reps, correct) -> bool:
        return self.mode == "mock" and self.mock is not None and self.mock.simulate_motion(gesture, reps, correct)

    # ------------------------------------------------------------------ playback step
    def step(self, dt: float) -> StepOut:
        if self.mode == "mock":
            out = self.mock.step(dt)
            self.t = self.mock.t
            if out.phase_finished:
                self.stop_phase()
            return out

        out = StepOut()
        r, prev = self.cur, self.pos
        self.t += dt
        self.pos += dt
        if self.pos >= self.end:
            if self.loop:
                self.pos = 0.0
                prev = -1.0
            else:
                out.phase_finished = True
        for p, e in self.sched:
            if prev < p <= self.pos:
                if e["name"] == "hold_start":
                    self.hold_open = True
                elif e["name"] == "hold_end_detected":
                    self.hold_open = False
                elif e["name"] == "cycle":
                    self.cycles = e["data"]["index"]
                out.events.append(dict(t=round(self.t - (self.pos - p), 2), source=SRC, **e))
        btn = getattr(self, "_pending_btn", None)
        if btn:
            out.events.append(dict(t=round(self.t, 2), source=SRC, **btn))
            self._pending_btn = None
        for bt in r.beats[(r.beats > prev) & (r.beats <= self.pos)]:
            earlier = r.beats[r.beats < bt]
            if len(earlier):
                ibi = (bt - earlier[-1]) * 1000.0
                if 300 < ibi < 2000:
                    out.beats.append((round(self.t - (self.pos - bt), 3), round(ibi, 1)))
        i = r.idx(self.pos)
        ph = float(r.phase[i])
        stage = "hold" if self.hold_open else ("inhale" if ph < 0.5 else "exhale")
        level = float(r.motion[i])
        if level >= 0.3:
            self.last_unstill = self.t
        pacer = self._pacer()
        if out.beats:
            self._last_ibi = out.beats[-1][1]
        last = self._last_ibi
        out.frame = dict(
            t=round(self.t, 3),
            breath=dict(phase=round(ph, 3), stage=stage, signal=round(float(r.breath[i]), 3), source=SRC,
                        confidence=0.4 if self.hold_open else 0.7),
            pacer=pacer,
            hb=dict(hbo_uM=round(float(r.hbo[i]), 4), hbr_uM=round(float(r.hbr[i]), 4), source=SRC),
            hr_instant=round(60000.0 / last, 1) if last else None,
            motion=dict(level=round(level, 3), still=level < 0.3, source=SRC),
        )
        if self.phase_name and self.phase_name.startswith("baseline") and level >= 0.3 and self.t - self.last_warn > 10:
            self.last_warn = self.t
            out.events.append(dict(t=round(self.t, 2), name="motion_warning", data=dict(level=round(level, 2)), source=SRC))
        return out

    def _pacer(self) -> dict | None:
        if not len(self.cycle_marks):
            return None
        past = self.cycle_marks[self.cycle_marks <= self.pos]
        if not len(past) or self.pos - past[-1] >= 10.0:
            return None
        u = self.pos - past[-1]
        tp = u / 4.5 * 0.5 if u < 4.5 else 0.5 + (u - 4.5) / 5.5 * 0.5
        return dict(target_phase=round(tp, 3), stage="inhale" if tp < 0.5 else "exhale")

    # ------------------------------------------------------------------ 1 Hz vitals
    def vitals(self) -> dict:
        if self.mode == "mock":
            return self.mock.vitals()
        r, pos = self.cur, self.pos
        b15 = r.beats[(r.beats > pos - 15) & (r.beats <= pos)]
        b60 = r.beats[(r.beats > pos - 60) & (r.beats <= pos)]
        hr = M.hr_from_ibis(list(np.diff(b15) * 1000))
        h = P.hrv(b60)                                       # NeuroKit2 hrv_time (needs >= 10 beats)
        rm = h["rmssd_ms"] if np.isfinite(h["rmssd_ms"]) else None
        sd = h["sdnn_ms"] if np.isfinite(h["sdnn_ms"]) else None
        if hr:
            self._last_hr = hr
        span = float(min(60.0, pos))
        frozen = self.t - self.last_unstill < 3.0
        w = r.window(r.slow, pos, 60)
        rate, rconf = None, 0.0
        if len(w) >= 20 * FS_OUT and not self.hold_open:
            rr = P.resp_rate(w, FS_OUT)                      # NeuroKit2 rsp_rate (trough)
            if np.isfinite(rr):
                rate, rconf = rr, 0.7
        rel = _rel_power(w)
        score = M.resonance_score(rel, self.res_base) if rel is not None else 0.0
        v = dict(
            t=round(self.t, 1),
            hr=dict(bpm=round(hr, 1) if hr else None, window_s=15, confidence=0.5 if frozen else 0.9,
                    frozen=frozen, source=SRC),
            hrv=dict(rmssd_ms=round(rm, 1) if rm else None, sdnn_ms=round(sd, 1) if sd else None,
                     window_s=round(span), confidence=round(0.6 * span / 60.0, 2) if rm else 0.0, source=SRC),
            resp=dict(rate_bpm=round(rate, 1) if rate else None, window_s=60, confidence=round(rconf, 2), source=SRC),
            resonance=dict(score=round(score), power_0p1_rel=round(rel, 3) if rel else 0.0,
                           baseline_rel=round(self.res_base, 3), source=SRC),
        )
        if self.phase_name == "resonance_breathing" and self.cycles >= 2:
            done = self.cycle_marks[self.cycle_marks + 10 <= pos]
            ph = []
            tt = np.arange(0, 10, 1 / FS_OUT)
            for on in done:
                seg = r.slow[r.idx(on):r.idx(on) + len(tt)]
                if len(seg) == len(tt):
                    seg = seg - seg.mean()
                    ph.append(np.angle(np.sum(seg * np.exp(-2j * np.pi * 0.1 * tt))))
            if len(ph) >= 2:
                v["phase_lock"] = dict(value=round(float(np.abs(np.mean(np.exp(1j * np.array(ph))))), 2),
                                       cycles=self.cycles, source=SRC)
        return v

    # ------------------------------------------------------------------ quality / probe
    def quality(self, setup: bool) -> dict:
        if self.mode == "mock":
            return self.mock.quality(setup)
        r = self.cur
        moving = self.t - self.last_unstill < 2.0
        warns = []
        n_sat = sum(c["status"] == "saturated" for c in r.channels)
        n_bad = sum(c["status"] in ("weak", "dark") for c in r.channels)
        if n_sat:
            warns.append(dict(code="saturation", text=f"Przesterowane kanały: {n_sat} – popraw docisk opaski"))
        if n_bad:
            warns.append(dict(code="weak_signal", text=f"Słaby sygnał w {n_bad} kanałach – odgarnij włosy pod czujnikami"))
        if moving:
            warns.append(dict(code="motion", text="Za dużo ruchu – usiądź wygodnie i nie ruszaj głową"))
        return dict(t=round(self.t, 1), ready=r.good_pct >= 70 and not moving, good_pct=r.good_pct,
                    sci_median=r.sci_median, motion_level="medium" if moving else "low",
                    channels=r.channels, warnings=warns)

    def probe(self) -> dict:
        return self.base.probe

    def channels(self) -> dict | None:
        """Per-channel HbO/HbR for the brain map (None during simulated phases)."""
        if self.mode == "mock":
            return None
        r = self.cur
        i = r.idx(self.pos)
        clean = lambda a: [None if not np.isfinite(v) else round(float(v), 3) for v in a]  # noqa: E731
        return dict(t=round(self.t, 2), hbo=clean(r.map_hbo[i]), hbr=clean(r.map_hbr[i]),
                    scale_uM=r.map_scale, source=SRC)

