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
_SRC_XY = {1: (-0.55, 0.30), 2: (-0.30, 0.42), 3: (0.30, 0.42), 4: (0.55, 0.30),
           5: (-0.25, 0.05), 6: (0.25, 0.05), 7: (-0.08, 0.18), 8: (0.42, 0.18)}
_DET_XY = {1: (-0.42, 0.20), 2: (0.42, 0.20), 3: (-0.50, 0.00), 4: (0.00, 0.10), 5: (0.50, 0.00)}


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
            hb=dict(hbo_uM=round(hbo, 4), hbr_uM=round(hbr, 4), source=SRC),
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

    def probe(self) -> dict:
        pairs = []
        for name, dist in PAIRS:
            s, d = (int(x[1:]) for x in name.split("_"))
            pairs.append(dict(pair=name, source=s, detector=d, distance_mm=dist, short=dist < 15))
        return dict(montage=self.montage, coords="2d_normalized",
                    sources=[dict(id=k, x=x, y=y) for k, (x, y) in _SRC_XY.items()],
                    detectors=[dict(id=k, x=x, y=y) for k, (x, y) in _DET_XY.items()],
                    pairs=pairs)
