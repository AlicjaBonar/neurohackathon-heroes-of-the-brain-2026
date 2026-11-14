"""Small metric formulas shared by the mock source, the summary and the demo seed."""
from __future__ import annotations

import math

MAYER_REL_REST = 0.093      # median share of 0.07-0.13 Hz power at rest (EDA, DOT RS)
RESONANCE_SPAN = 0.15       # rise of that share that maps to a score of 100


def resonance_score(power_rel: float, baseline_rel: float = MAYER_REL_REST) -> float:
    return max(0.0, min(100.0, 100.0 * (power_rel - baseline_rel) / RESONANCE_SPAN))


def resonance_power(score: float, baseline_rel: float = MAYER_REL_REST) -> float:
    return baseline_rel + score / 100.0 * RESONANCE_SPAN


def _valid(ibis_ms: list[float]) -> list[float]:
    if not ibis_ms:
        return []
    med = sorted(ibis_ms)[len(ibis_ms) // 2]
    return [x for x in ibis_ms if 0.6 * med < x < 1.4 * med and 330 < x < 1600]


def hr_from_ibis(ibis_ms: list[float]) -> float | None:
    v = _valid(ibis_ms)
    return 60000.0 / (sum(v) / len(v)) if len(v) >= 3 else None


def rmssd(ibis_ms: list[float]) -> float | None:
    v = _valid(ibis_ms)
    if len(v) < 10:
        return None
    d = [b - a for a, b in zip(v, v[1:])]
    return math.sqrt(sum(x * x for x in d) / len(d))


def sdnn(ibis_ms: list[float]) -> float | None:
    v = _valid(ibis_ms)
    if len(v) < 10:
        return None
    m = sum(v) / len(v)
    return math.sqrt(sum((x - m) ** 2 for x in v) / len(v))


def crf_jurca(sex: str | None, age: float | None, bmi: float | None, hr_rest: float | None,
              activity: float | None) -> float | None:
    """Non-exercise cardiorespiratory fitness [MET], Jurca et al. 2005."""
    if None in (sex, age, bmi, hr_rest, activity):
        return None
    return (2.77 * (1 if sex == "M" else 0) - 0.10 * age - 0.17 * bmi
            - 0.03 * hr_rest + 1.00 * activity + 18.07)


def mean(xs: list[float]) -> float | None:
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None
