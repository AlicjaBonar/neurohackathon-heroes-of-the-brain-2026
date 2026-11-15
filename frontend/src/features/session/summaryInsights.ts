import type { Insight, Summary } from "@/api/types";

/**
 * English insights for the summary screen, built from the numbers (the backend's own
 * insight texts are Polish and used elsewhere in the app).
 */
export function buildInsights(s: Summary): Insight[] {
  const out: Insight[] = [];
  const d = s.delta;
  const real = s.sources?.hr === "real";

  if (d?.hr_bpm != null) {
    if (d.hr_bpm <= -2) {
      out.push({ kind: "positive", text: `Your resting heart rate dropped by ${Math.abs(d.hr_bpm).toFixed(0)} bpm after the exercise – your body calmed down.` });
    } else if (d.hr_bpm >= 3) {
      out.push({ kind: "info", text: `Heart rate is ${d.hr_bpm.toFixed(0)} bpm higher than before. Give yourself a minute of slow, easy breathing.` });
    } else {
      out.push({ kind: "info", text: "Heart rate before and after the exercise is about the same." });
    }
  }
  if (d?.rmssd_pct != null) {
    if (d.rmssd_pct >= 10) {
      out.push({ kind: "positive", text: `HRV (RMSSD) rose by ${d.rmssd_pct.toFixed(0)}% – a sign of more rest-and-digest (parasympathetic) activity.` });
    } else if (d.rmssd_pct <= -10) {
      out.push({ kind: "info", text: `HRV (RMSSD) is ${Math.abs(d.rmssd_pct).toFixed(0)}% lower than before. Short measurements vary a lot – compare over several sessions.` });
    }
  }

  const pl = s.scores?.phase_lock;
  if (pl != null) {
    out.push(
      pl >= 0.7
        ? { kind: "positive", text: `You followed the 6 breaths/min rhythm closely (${Math.round(pl * 100)}% rhythm match).` }
        : { kind: "tip", text: `Rhythm match was ${Math.round(pl * 100)}%. Follow the pacer smoothly: inhale for 4.5 s, exhale for 5.5 s.` },
    );
  }
  const res = s.scores?.resonance;
  if (res != null) {
    out.push(
      res >= 50
        ? { kind: "positive", text: `Strong resonance (${res}/100): breathing at 6/min amplified the 0.1 Hz oscillations of your circulation.` }
        : { kind: "tip", text: `Resonance reached ${res}/100. Slower, deeper exhales usually make the 0.1 Hz wave stronger.` },
    );
  }

  if (s.holds.length) {
    const longest = Math.max(...s.holds.map((h) => h.hold_s));
    const rise = Math.max(...s.holds.map((h) => h.hbo_rise_uM));
    out.push({ kind: "info", text: `Longest breath hold: ${longest.toFixed(0)} s. Oxygenated blood in the forehead rose by up to ${rise.toFixed(2)} µM during the holds.` });
  }
  for (const m of s.movement) {
    out.push({
      kind: m.verified ? "positive" : "tip",
      text: `Movement “${m.target.replace("_", " ")}”: ${m.detected_reps} of ${m.reps} repetitions detected.`,
    });
  }
  if (s.recovery) {
    out.push({ kind: "info", text: `Heart rate fell by ${s.recovery.drop_1min_bpm} bpm in the first minute of recovery (simulated).` });
  }

  const q = s.quality;
  if (q.measured_s && q.motion_s > 0.2 * q.measured_s) {
    out.push({ kind: "tip", text: "There was quite a lot of movement – keep your head still next time for more accurate results." });
  }
  if (q.good_pct != null && q.good_pct < 70) {
    out.push({ kind: "tip", text: `Only ${q.good_pct.toFixed(0)}% of channels had good contact. Adjust the cap and move hair away from the sensors.` });
  }
  if (real && s.after) {
    out.push({
      kind: "info",
      text:
        s.after_from === "exercise_end"
          ? "Recorded data: “after” is the 20 s of rest right after the last breathing set in this person's recording."
          : "Recorded data: the dataset has no rest after this exercise, so “after” comes from a later part of the same resting recording.",
    });
    out.push({
      kind: "info",
      text: "HRV from this 18 Hz recording is approximate: beat timing is only known to about ±25 ms, which inflates RMSSD.",
    });
  }
  return out;
}

/** One-word verdict for the relaxation score. */
export function relaxationVerdict(score: number) {
  if (score >= 70) return "Deeply relaxed";
  if (score >= 55) return "Relaxed";
  if (score >= 40) return "Balanced";
  return "Activated";
}
