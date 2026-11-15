"""Exercise catalogue and phase plans (docs/APP_SPEC.md V5).

A phase is a list of segments. Segment kinds:
  free     - spontaneous breathing
  paced    - breathing with the pacer, `cycles` x 10 s (inhale 4.5 s, exhale 5.5 s)
  hold     - breath hold; dur=None means maximal (ends by detector or user button)
  recover  - heart-rate recovery after exertion (simulated)
"""
from __future__ import annotations

from dataclasses import dataclass

CYCLE_S = 10.0
INHALE_S = 4.5
MAX_HOLD_NOMINAL_S = 35.0


@dataclass
class Segment:
    kind: str
    dur: float | None = None
    cycles: int = 0


def plan(phase: str, baseline_s: float = 120.0) -> list[Segment]:
    if phase in ("baseline_pre", "baseline_post"):
        return [Segment("free", baseline_s)]
    if phase == "resonance_breathing":      # same structure as the SPB task in the dataset
        return [Segment("free", 30), Segment("paced", 50, cycles=5), Segment("free", 60),
                Segment("paced", 50, cycles=5), Segment("free", 60),
                Segment("paced", 50, cycles=5), Segment("free", 20)]
    if phase == "short_holds":              # as BH in the DOT dataset: 7 x (30 s breathing + 10 s hold)
        return [s for _ in range(7) for s in (Segment("free", 30), Segment("hold", 10))] + [Segment("free", 30)]
    if phase == "breath_hold":
        return [Segment("free", 30), Segment("hold", None), Segment("free", 45)]
    if phase == "hr_recovery":
        return [Segment("recover", 120)]
    raise KeyError(phase)


def plan_duration(segs: list[Segment]) -> float:
    return sum(s.dur if s.dur is not None else MAX_HOLD_NOMINAL_S for s in segs)


BASELINES = ("baseline_pre", "baseline_post")

CATALOG = [
    dict(id="resonance_breathing", title="Resonance breathing 6/min",
         description="Inhale 4.5 s, exhale 5.5 s. Three sets of 5 breaths with 60 s rests.",
         measures=[dict(name="phase_lock", label="rhythm match", source="real"),
                   dict(name="resonance_score", label="resonance", source="real"),
                   dict(name="hr_bpm", label="heart rate", source="real"),
                   dict(name="rmssd_ms", label="HRV", source="real")]),
    dict(id="short_holds", title="Short breath holds 7 × 10 s",
         description="30 s of calm breathing, then a 10 s breath hold. Seven repetitions.",
         measures=[dict(name="hold_hbo_peak_uM", label="HbO response", source="real")]),
    dict(id="breath_hold", title="Maximal breath hold",
         description="Hold your breath for as long as is comfortable. The end is detected automatically.",
         measures=[dict(name="hold_s", label="hold time", source="real"),
                   dict(name="hold_hbo_peak_uM", label="HbO response", source="real")]),
    dict(id="hr_recovery", title="Heart rate recovery after exercise",
         description="Two calm minutes after exercise: how fast your heart rate returns to normal.",
         measures=[dict(name="hr_recovery_drop_bpm", label="heart rate drop in the 1st minute", source="simulated")]),
]
EXERCISE_IDS = tuple(c["id"] for c in CATALOG)
PHASES = BASELINES + EXERCISE_IDS


def catalog() -> list[dict]:
    out = []
    for c in CATALOG:
        segs = plan(c["id"])
        out.append({**c, "duration_s": plan_duration(segs),
                    "segments": [dict(kind=s.kind, duration_s=s.dur, cycles=s.cycles or None) for s in segs]})
    return out
