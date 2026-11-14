"""Mock signal source: a small physiological simulator behind the stream contract.

Everything it produces is flagged source="simulated". Its shapes follow what the EDA found in
the real recordings (results/EDA_REPORT.md): HbO minimum ~2 s into the inhale and maximum ~6 s
into a 10 s paced cycle, doubling of 0.1 Hz power during paced breathing, HbO/HbR rising through
a breath hold. A replay source for SNIRF files will implement the same interface:

    start_phase(name) -> duration_s      stop_phase()
    step(dt) -> StepOut                  vitals() -> dict      quality(setup) -> dict
    probe() -> dict                      user_event(name)      simulate_motion(gesture, reps, correct)
"""
from __future__ import annotations

import math
import random
from collections import deque
from dataclasses import dataclass, field

from . import exercises as ex
from . import metrics as M

SRC = "simulated"
PAIRS = [("S1_D1", 30.0), ("S2_D1", 23.0), ("S3_D2", 23.0), ("S4_D2", 30.0), ("S5_D3", 30.0),
         ("S5_D4", 30.0), ("S6_D4", 30.0), ("S6_D5", 30.0), ("S7_D4", 10.0), ("S8_D5", 10.0)]
# head unit circle (Cz = 0,0, nose up, radius 1), roughly like the supine prefrontal montage
_SRC_XY = {1: (-0.42, 0.86), 2: (-0.20, 0.92), 3: (0.20, 0.92), 4: (0.42, 0.86),
           5: (-0.30, 0.62), 6: (0.30, 0.62), 7: (-0.05, 0.78), 8: (0.30, 0.74)}
_DET_XY = {1: (-0.34, 0.76), 2: (0.34, 0.76), 3: (-0.45, 0.62), 4: (0.00, 0.70), 5: (0.45, 0.62)}
_LANDMARKS = {"Nz": (0.0, 1.0), "Fpz": (0.0, 0.95), "Fp1": (-0.29, 0.92), "Fp2": (0.29, 0.92),
              "AF7": (-0.55, 0.80), "AF3": (-0.24, 0.80), "AFz": (0.0, 0.80), "AF4": (0.24, 0.80),
              "AF8": (0.55, 0.80), "F3": (-0.40, 0.62), "Fz": (0.0, 0.62), "F4": (0.40, 0.62),
              "Cz": (0.0, 0.0), "T7": (-0.92, 0.0), "T8": (0.92, 0.0)}


@dataclass
class StepOut:
    frame: dict = field(default_factory=dict)
    beats: list[tuple[float, float]] = field(default_factory=list)      # (t, ibi_ms)
    events: list[dict] = field(default_factory=list)
    phase_finished: bool = False


class MockSource:
    fs_hz = 10.0
    n_pairs = len(PAIRS)
    montage = "mock_prefrontal"

    def __init__(self, seed: int | None = None, baseline_s: float = 120.0):
        self.rng = random.Random(seed)
        self.baseline_s = baseline_s
        self.t = 0.0
        # breathing
        self.phase = 0.0                 # 0..1 breath phase
        self.amp = 0.6
        self.signal = 0.0
        self.rate_ou = 0.0
        self.err = 0.0                   # phase error vs pacer
        self.lock = 0.45
        self.cycles = 0
        self.resonance = 12.0
        # heart
        self.hr_base = 62.0 + 16.0 * self.rng.random()
        self.relax = 0.0                 # lasting HR change after paced breathing [bpm]
        self.hr_ou = 0.0
        self.hold_hr = 0.0
        self.hr_inst = self.hr_base
        self.beat_acc = self.rng.random()
        self.last_beat = 0.0
        self.beats: deque[tuple[float, float]] = deque(maxlen=400)
        # haemoglobin / motion
        self.drift = 0.0
        self.hold_rise = 0.0
        self.m_ou = 0.0
        self.twitch_until = -1.0
        self.burst_until = -1.0
        self.last_unstill = -99.0
        self.last_warn = -99.0
        # phase plan
        self.phase_name: str | None = None
        self.segs: list[ex.Segment] = []
        self.seg: ex.Segment | None = None
        self.seg_t = 0.0
        self.set_no = 0
        self._cycle_in_seg = -1
        self._move: dict = {}
        self._hold_by = "detector"
        self._rec_hr0 = None
        self._pending: list[dict] = []

    # ------------------------------------------------------------------ phase control
    def start_phase(self, name: str) -> float:
        self.segs = ex.plan(name, self.baseline_s)
        self.phase_name = name
        dur = ex.plan_duration(self.segs)
        if name == "resonance_breathing":
            self.lock, self.cycles, self.set_no = 0.45, 0, 0
        self._next_seg()
        return dur

    def stop_phase(self) -> None:
        self.segs, self.seg, self.phase_name = [], None, None

    def _ev(self, name: str, data: dict | None = None, confidence: float | None = None,
            source: str = SRC) -> None:
        self._pending.append(dict(t=round(self.t, 3), name=name, data=data, confidence=confidence, source=source))

    def _next_seg(self) -> bool:
        """Advance to the next segment; False when the phase plan is exhausted."""
        if not self.segs:
            self.seg = None
            return False
        self.seg, self.seg_t = self.segs.pop(0), 0.0
        s = self.seg
        if s.kind == "paced":
            self.set_no += 1
            self._cycle_in_seg = -1
            self._sync_phase = True
        elif s.kind == "hold":
            self._hold_by = "detector"
            if s.dur is None:
                s.dur = self.rng.uniform(25, 45)
                self._ev("hold_start", dict(kind="max"))
            else:
                self._ev("hold_start", dict(kind="short", target_s=s.dur))
        elif s.kind == "move":
            self._move = dict(exec_at=self.rng.uniform(2, 4), correct=self.rng.random() < 0.9,
                              started=False, reported=False, end=0.0)
            self._ev("command_issued", dict(target=s.gesture, reps=s.reps))
        elif s.kind == "recover":
            self._rec_hr0 = None
        return True

    def _end_seg(self) -> None:
        s = self.seg
        if s.kind == "hold":
            conf = 1.0 if self._hold_by == "button" else round(self.rng.uniform(0.7, 0.95), 2)
            self._ev("hold_end_detected", dict(hold_s=round(self.seg_t, 1), by=self._hold_by,
                                               hbo_rise_uM=round(self.hold_rise, 3)), conf)
        elif s.kind == "recover" and self._rec_hr0 is not None:
            self._ev("recovery_measured", dict(drop_1min_bpm=round(self._rec_drop, 1), tau_s=45))

    def user_event(self, name: str) -> bool:
        if name == "hold_end_button" and self.seg and self.seg.kind == "hold":
            self._hold_by = "button"
            self.seg.dur = self.seg_t
            return True
        return False

    def simulate_motion(self, gesture: str | None, reps: int | None, correct: bool) -> bool:
        if not (self.seg and self.seg.kind == "move") or self._move["started"]:
            return False
        if gesture:
            self._move["gesture"] = gesture
        if reps:
            self._move["reps"] = reps
        self._move.update(exec_at=self.seg_t, correct=correct)
        return True

    # ------------------------------------------------------------------ simulation step
    def _best_channel(self, hbo: float, hbr: float, pulse: float, dt: float) -> dict:
        """One channel instead of the mean: larger swings and its own noise."""
        if not hasattr(self, "_best_meta"):
            first = next(p for p in self.probe()["pairs"] if not p["short"])
            self._best_meta = dict(pair=first["pair"], label=first["label"], sci=0.98)
            self._best_n = 0.0
        self._best_n = self._ou(self._best_n, 1.5, 0.05, dt)
        o_tr = 1.4 * (hbo - pulse) + self._best_n
        r_tr = 1.3 * hbr - 0.3 * self._best_n
        return dict(**self._best_meta, hbo_uM=round(o_tr + 1.6 * pulse, 4), hbr_uM=round(r_tr, 4),
                    hbo_trend_uM=round(o_tr, 4), hbr_trend_uM=round(r_tr, 4))

    def _ou(self, x: float, tau: float, sigma: float, dt: float) -> float:
        return x - x * dt / tau + sigma * math.sqrt(2 * dt / tau) * self.rng.gauss(0, 1)

    def step(self, dt: float) -> StepOut:
        out = StepOut()
        self.t += dt
        rng = self.rng

        # --- segment bookkeeping
        if self.seg is not None:
            self.seg_t += dt
            if self.seg_t >= self.seg.dur - 1e-9:
                self._end_seg()
                if not self._next_seg():
                    out.phase_finished = True
                    self.phase_name = None
        kind = self.seg.kind if self.seg else "free"
        in_resonance = self.phase_name == "resonance_breathing"

        # --- breathing
        pacer = None
        if kind == "paced":
            u = self.seg_t % ex.CYCLE_S
            c = int(self.seg_t // ex.CYCLE_S)
            if c != self._cycle_in_seg and c < self.seg.cycles:
                self._cycle_in_seg = c
                self.cycles += 1
                self._ev("cycle", dict(index=self.cycles, set=self.set_no, in_set=c + 1))
            target = (u / ex.INHALE_S * 0.5 if u < ex.INHALE_S
                      else 0.5 + (u - ex.INHALE_S) / (ex.CYCLE_S - ex.INHALE_S) * 0.5)
            if getattr(self, "_sync_phase", False):
                # Start of a set: the person is still mid-breath, so the breath does not jump to the
                # pacer; the error starts at the current offset and decays as they catch up.
                self._sync_phase = False
                self.err = (self.phase - target + 0.5) % 1.0 - 0.5
            self.lock += (0.88 - self.lock) * dt / 25.0
            self.err = self._ou(self.err, 4.0, 0.12 * (1 - self.lock) + 0.015, dt)
            self.phase = (target + self.err) % 1.0
            pacer = dict(target_phase=round(target, 3), stage="inhale" if target < 0.5 else "exhale")
            amp_target, conf = 1.2, 0.85
        elif kind == "hold":
            amp_target, conf = 0.05, 0.4
        else:
            self.rate_ou = self._ou(self.rate_ou, 8.0, 1.0, dt)
            rate = (0.22 + 0.008 * self.relax) * (1 + 0.12 * self.rate_ou)
            if kind == "recover":
                rate *= 1.0 + 0.6 * math.exp(-self.seg_t / 40.0)
            self.phase = (self.phase + max(0.08, rate) * dt) % 1.0
            self._rate = max(0.08, rate)
            amp_target, conf = 0.6, 0.6
        self.amp += (amp_target - self.amp) * dt / 2.0
        # HbO respiratory wave: minimum ~phase 0.2, maximum ~phase 0.65 (as in the SPB cycle average)
        self.signal = -self.amp * math.cos(2 * math.pi * (self.phase - 0.2)) + 0.06 * rng.gauss(0, 1)
        stage = "hold" if kind == "hold" else ("inhale" if self.phase < 0.5 else "exhale")

        # --- resonance (0.1 Hz power)
        res_target = 55 + 35 * self.lock if kind == "paced" else (30.0 if in_resonance else 12.0)
        self.resonance += (res_target - self.resonance) * dt / 12.0 + 0.4 * rng.gauss(0, 1) * math.sqrt(dt)
        self.resonance = max(0.0, min(100.0, self.resonance))

        # --- heart
        if kind == "paced":
            self.relax += (-3.5 - self.relax) * dt / 90.0
        self.hr_ou = self._ou(self.hr_ou, 20.0, 1.5, dt)
        if kind == "hold":
            self.hold_hr += (-4.0 - self.hold_hr) * dt / 8.0
        else:
            self.hold_hr -= self.hold_hr * dt / 6.0
        rec = 0.0
        if kind == "recover":
            rec = 45.0 * math.exp(-self.seg_t / 45.0)
            if self._rec_hr0 is None:
                self._rec_hr0, self._rec_drop = 45.0, 0.0
            if self.seg_t <= 60.0:
                self._rec_drop = 45.0 - rec
        rsa = (1.5 + 5.0 * self.resonance / 100.0) * math.sin(2 * math.pi * (self.phase - 0.1))
        self.hr_inst = self.hr_base + self.relax + self.hr_ou + self.hold_hr + rec + rsa * (0.2 if kind == "hold" else 1)
        inc = self.hr_inst / 60.0 * dt
        self.beat_acc += inc
        if self.beat_acc >= 1.0:
            self.beat_acc -= 1.0
            bt = self.t - (self.beat_acc / inc) * dt
            ibi = (bt - self.last_beat) * 1000.0 + rng.gauss(0, 10.0)
            self.last_beat = bt
            if 300 < ibi < 2000:
                self.beats.append((bt, ibi))
                out.beats.append((round(bt, 3), round(ibi, 1)))

        # --- haemoglobin
        self.drift = self._ou(self.drift, 60.0, 0.15, dt)
        if kind == "hold":
            self.hold_rise += 0.016 * dt
        else:
            self.hold_rise -= self.hold_rise * dt / 10.0
        pulse = 0.03 * math.sin(2 * math.pi * self.beat_acc)
        hbo = self.drift + 0.12 * self.signal + pulse + self.hold_rise
        hbr = -0.06 * self.drift - 0.03 * self.signal + 0.55 * self.hold_rise + 0.01 * rng.gauss(0, 1)
        self._hbo, self._hbr = hbo, hbr

        # --- motion
        self.m_ou = self._ou(self.m_ou, 2.0, 0.05, dt)
        level = abs(self.m_ou) + 0.04
        if kind == "move":
            mv = self._move
            if not mv["started"] and self.seg_t >= mv["exec_at"]:
                mv["started"] = True
                reps = mv.get("reps", self.seg.reps)
                mv["done_reps"] = reps if mv["correct"] else max(0, reps - rng.choice([1, 2]))
                mv["end"] = self.seg_t + 0.9 * max(1, mv["done_reps"])
                self.burst_until = self.t + (mv["end"] - self.seg_t)
            if mv["started"] and not mv["reported"] and self.seg_t >= mv["end"]:
                mv["reported"] = True
                target, reps = mv.get("gesture", self.seg.gesture), mv.get("reps", self.seg.reps)
                data = dict(target=target, reps=reps, detected_reps=mv["done_reps"])
                if mv["correct"]:
                    self._ev("command_verified", data, round(rng.uniform(0.8, 0.97), 2))
                else:
                    self._ev("command_failed", {**data, "reason": "too_few_reps"}, round(rng.uniform(0.7, 0.9), 2))
        elif rng.random() < 0.0015 and self.t > self.twitch_until:
            self.twitch_until = self.t + 1.2
        if self.t < self.burst_until:
            level += 0.75 + 0.2 * abs(math.sin(2 * math.pi * self.t / 0.9))
        elif self.t < self.twitch_until:
            level += 0.45
        level = min(1.0, level)
        still = level < 0.3
        if not still:
            self.last_unstill = self.t
            if (self.phase_name or "").startswith("baseline") and self.t - self.last_warn > 10:
                self.last_warn = self.t
                self._ev("motion_warning", dict(level=round(level, 2)))

        out.events, self._pending = self._pending, []
        out.frame = dict(
            t=round(self.t, 3),
            breath=dict(phase=round(self.phase, 3), stage=stage, signal=round(self.signal, 3),
                        source=SRC, confidence=conf),
            pacer=pacer,
            hb=dict(hbo_uM=round(hbo, 4), hbr_uM=round(hbr, 4),
                    hbo_trend_uM=round(hbo - pulse, 4), hbr_trend_uM=round(hbr, 4),
                    n_channels=sum(d >= 15 for _, d in PAIRS), best=self._best_channel(hbo, hbr, pulse, dt),
                    source=SRC),
            hr_instant=round(self.hr_inst, 1),
            motion=dict(level=round(level, 3), still=still, source=SRC),
        )
        self._kind = kind
        return out

    # ------------------------------------------------------------------ 1 Hz vitals
    def vitals(self) -> dict:
        kind = getattr(self, "_kind", "free")
        ib15 = [i for (bt, i) in self.beats if bt > self.t - 15]
        ib60 = [i for (bt, i) in self.beats if bt > self.t - 60]
        span = min(60.0, self.t)
        frozen = self.t - self.last_unstill < 3.0
        hr = M.hr_from_ibis(ib15)
        rm, sd = M.rmssd(ib60), M.sdnn(ib60)
        if kind == "paced":
            rate, rconf = 6.0 + self.rng.gauss(0, 0.15), 0.8
        elif kind == "hold":
            rate, rconf = None, 0.2
        else:
            rate, rconf = 60.0 * getattr(self, "_rate", 0.22) + self.rng.gauss(0, 0.6), 0.55
        v = dict(
            t=round(self.t, 1),
            hr=dict(bpm=round(hr, 1) if hr else None, window_s=15, confidence=0.5 if frozen else 0.95,
                    frozen=frozen, source=SRC),
            hrv=dict(rmssd_ms=round(rm, 1) if rm else None, sdnn_ms=round(sd, 1) if sd else None,
                     window_s=round(span), confidence=round(0.75 * span / 60.0, 2) if rm else 0.0, source=SRC),
            resp=dict(rate_bpm=round(rate, 1) if rate else None, window_s=60, confidence=rconf, source=SRC),
            resonance=dict(score=round(self.resonance), power_0p1_rel=round(M.resonance_power(self.resonance), 3),
                           baseline_rel=M.MAYER_REL_REST, source=SRC),
        )
        if self.phase_name == "resonance_breathing" and self.cycles >= 1:
            lock = max(0.0, min(1.0, self.lock + self.rng.gauss(0, 0.03)))
            v["phase_lock"] = dict(value=round(lock, 2), cycles=self.cycles, source=SRC)
        return v

    # ------------------------------------------------------------------ quality / probe
    def quality(self, setup: bool) -> dict:
        settling = setup and self.t < 4.0          # first seconds: show a bad fit, then it settles
        chans, warns = [], []
        for name, dist in PAIRS:
            status, sci = "good", min(0.999, 0.975 + self.rng.gauss(0, 0.01))
            if settling and name == "S3_D2":
                status, sci = "saturated", -0.08
            elif settling and name == "S7_D4":
                status, sci = "weak", 0.52
            chans.append(dict(pair=name, status=status, sci=round(sci, 3), distance_mm=dist))
        n_sat = sum(c["status"] == "saturated" for c in chans)
        n_weak = sum(c["status"] in ("weak", "dark") for c in chans)
        if n_sat:
            warns.append(dict(code="saturation", text=f"{n_sat} kanał przesterowany – popraw docisk opaski"))
        if n_weak:
            warns.append(dict(code="weak_signal", text=f"{n_weak} kanał ma słaby sygnał – odgarnij włosy pod czujnikiem"))
        moving = self.t - self.last_unstill < 2.0
        if moving:
            warns.append(dict(code="motion", text="Za dużo ruchu – usiądź wygodnie i nie ruszaj głową"))
        good = 100.0 * sum(c["status"] == "good" for c in chans) / len(chans)
        scis = sorted(c["sci"] for c in chans)
        return dict(t=round(self.t, 1), ready=good >= 85 and not moving, good_pct=good,
                    sci_median=scis[len(scis) // 2], motion_level="medium" if moving else "low",
                    channels=chans, warnings=warns)

    @staticmethod
    def _to3d(x: float, y: float, r: float = 95.0) -> list[float]:
        """Head-map point (Cz centre, radius 1 at the equator) -> point on a sphere [mm]."""
        rho = math.hypot(x, y)
        th, ph = rho * math.pi / 2, math.atan2(y, x)
        return [round(r * math.sin(th) * math.cos(ph), 1), round(r * math.sin(th) * math.sin(ph), 1),
                round(r * math.cos(th), 1)]

    def probe(self) -> dict:
        pairs = []
        for i, (name, dist) in enumerate(PAIRS):
            s, d = (int(x[1:]) for x in name.split("_"))
            mx = (_SRC_XY[s][0] + _DET_XY[d][0]) / 2
            my = (_SRC_XY[s][1] + _DET_XY[d][1]) / 2
            near = min(_LANDMARKS, key=lambda k: (_LANDMARKS[k][0] - mx) ** 2 + (_LANDMARKS[k][1] - my) ** 2)
            p3 = self._to3d(mx, my)
            nrm = [round(v / 95.0, 3) for v in p3]
            pairs.append(dict(index=i, pair=name, source=s, detector=d, distance_mm=dist, short=dist < 15,
                              x=round(mx, 3), y=round(my, 3), label=near, pos3d=p3, normal=nrm,
                              cortex3d=[round(v - 15.0 * n, 1) for v, n in zip(p3, nrm)]))
        return dict(montage=self.montage, coords="head_unit_circle",
                    orientation="x: right, y: nose; Cz = (0, 0), head radius = 1",
                    sources=[dict(id=k, x=x, y=y, pos3d=self._to3d(x, y)) for k, (x, y) in _SRC_XY.items()],
                    detectors=[dict(id=k, x=x, y=y, pos3d=self._to3d(x, y)) for k, (x, y) in _DET_XY.items()],
                    landmarks=[dict(label=k, x=x, y=y, pos3d=self._to3d(x, y)) for k, (x, y) in _LANDMARKS.items()],
                    head3d=dict(units="mm", frame="x: right, y: nose, z: up; origin = head centre",
                                ellipsoid_radii_mm=[95.0, 95.0, 95.0], cortex_depth_mm=15.0,
                                points=[dict(label=k, pos3d=self._to3d(x, y)) for k, (x, y) in _LANDMARKS.items()]),
                    pairs=pairs)

    def channels(self) -> dict:
        """Per-channel HbO/HbR for the brain map: common signal x channel gain + local noise."""
        if not hasattr(self, "_gain"):
            self._gain = [(0.6 if d < 15 else 1.0) * self.rng.uniform(0.6, 1.4) for _, d in PAIRS]
            self._noise = [0.0] * len(PAIRS)
        hbo, hbr = getattr(self, "_hbo", 0.0), getattr(self, "_hbr", 0.0)
        vals_o, vals_r = [], []
        for k, g in enumerate(self._gain):
            self._noise[k] = 0.9 * self._noise[k] + 0.03 * self.rng.gauss(0, 1)
            vals_o.append(round(g * hbo + self._noise[k], 3))
            vals_r.append(round(g * hbr - 0.3 * self._noise[k], 3))
        return dict(t=round(self.t, 2), hbo=vals_o, hbr=vals_r, scale_uM=0.4, source=SRC)
