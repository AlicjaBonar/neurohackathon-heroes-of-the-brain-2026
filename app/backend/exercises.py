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
    dict(id="resonance_breathing", title="Oddech rezonansowy 6/min",
         description="Wdech 4,5 s, wydech 5,5 s. Trzy serie po 5 oddechów z przerwami 60 s.",
         measures=[dict(name="phase_lock", label="zgodność z rytmem", source="real"),
                   dict(name="resonance_score", label="rezonans", source="real"),
                   dict(name="hr_bpm", label="tętno", source="real"),
                   dict(name="rmssd_ms", label="HRV", source="real")]),
    dict(id="short_holds", title="Seria krótkich bezdechów 7 × 10 s",
         description="30 s spokojnego oddechu, potem 10 s bezdechu. Siedem powtórzeń.",
         measures=[dict(name="hold_hbo_peak_uM", label="reakcja HbO", source="real")]),
    dict(id="breath_hold", title="Bezdech maksymalny",
         description="Wstrzymaj oddech tak długo, jak to komfortowe. Koniec wykrywamy automatycznie.",
         measures=[dict(name="hold_s", label="czas bezdechu", source="real"),
                   dict(name="hold_hbo_peak_uM", label="reakcja HbO", source="real")]),
    dict(id="hr_recovery", title="Powrót tętna po wysiłku",
         description="Dwie minuty spokoju po wysiłku: jak szybko tętno wraca do normy.",
         measures=[dict(name="hr_recovery_drop_bpm", label="spadek tętna w 1. minucie", source="simulated")]),
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
