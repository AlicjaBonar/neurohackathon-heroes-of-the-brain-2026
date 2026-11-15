import type { Source, SeriesPoint, Summary } from "@/api/types";

/** Which direction of change is "better" for a metric; null = no judgement. */
type Good = "up" | "down" | null;

export type MetricDef = {
  key: string;
  label: string;
  unit: string;
  digits: number;
  /** Same colours as the live tiles in the session view. */
  color: string;
  good: Good;
  /** Multiplier applied to the stored value (phase lock is stored as 0-1). */
  scale?: number;
  note: string;
};

/** The metrics the backend stores per session (docs 7.3), in display order. */
export const METRICS: MetricDef[] = [
  { key: "hr_bpm", label: "Resting heart rate", unit: " bpm", digits: 0, color: "#6366f1", good: "down", note: "measured before the exercise" },
  { key: "rmssd_ms", label: "HRV • RMSSD", unit: " ms", digits: 0, color: "#10b981", good: "up", note: "measured before the exercise" },
  { key: "resp_rate_bpm", label: "Breathing rate", unit: " /min", digits: 1, color: "#00a8c9", good: null, note: "low measurement confidence" },
  { key: "resonance_score", label: "Resonance 0.1 Hz", unit: " /100", digits: 0, color: "#a855f7", good: "up", note: "resonance breathing" },
  { key: "phase_lock", label: "Rhythm match", unit: "%", digits: 0, color: "#14b8a6", good: "up", scale: 100, note: "breathing vs. the 6/min pace" },
  { key: "hold_s", label: "Breath hold", unit: " s", digits: 0, color: "#0ea5e9", good: "up", note: "longest in the session" },
  { key: "hold_hbo_peak_uM", label: "HbO rise", unit: " µM", digits: 2, color: "#3b82f6", good: null, note: "cortical response to the hold" },
  { key: "relaxation_score", label: "Relaxation", unit: " /100", digits: 0, color: "#65a30d", good: "up", note: "change in heart rate, HRV and resonance" },
  { key: "crf_mets", label: "Fitness (CRF)", unit: " MET", digits: 1, color: "#0f766e", good: "up", note: "Jurca 2005 formula" },
  { key: "hr_recovery_drop_bpm", label: "Heart rate recovery", unit: " bpm", digits: 0, color: "#c026d3", good: "up", note: "drop in the 1st minute" },
  { key: "good_pct", label: "Signal quality", unit: "%", digits: 0, color: "#64748b", good: "up", note: "good channels" },
];

export const HISTORY_KEYS = METRICS.map((m) => m.key);

export type Point = { t: string; value: number; source?: Source; session_id?: string };

export type MetricStat = {
  def: MetricDef;
  points: Point[];
  latest: Point;
  /** Mean of up to 7 earlier sessions; null with a single session. */
  usual: number | null;
  delta: number | null;
  /** Whether the change is an improvement (null = neutral or unknown). */
  improved: boolean | null;
};

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const scaled = (def: MetricDef, v: number) => v * (def.scale ?? 1);

/** Latest value, own baseline and change for every metric that has data. */
export function buildStats(metrics: Record<string, SeriesPoint[]>): MetricStat[] {
  const out: MetricStat[] = [];
  for (const def of METRICS) {
    const points = (metrics[def.key] ?? []).map((p) => ({ ...p, value: scaled(def, p.value) }));
    if (!points.length) continue;
    const latest = points[points.length - 1];
    const prev = points.slice(-8, -1).map((p) => p.value);
    const usual = prev.length ? mean(prev) : null;
    const delta = usual === null ? null : latest.value - usual;
    const threshold = Math.pow(10, -def.digits) / 2;
    const improved =
      delta === null || def.good === null || Math.abs(delta) < threshold ? null : def.good === "up" ? delta > 0 : delta < 0;
    out.push({ def, points, latest, usual, delta, improved });
  }
  return out;
}

export const fmt = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);

export const signed = (value: number, digits = 0) => `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;

const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit" });
export const shortDate = (iso: string) => DATE.format(new Date(iso));

export function summaryBars(s: Summary) {
  const bars: { label: string; hint?: string; value: number }[] = [];
  if (s.scores?.relaxation !== undefined) bars.push({ label: "Relaxation", value: s.scores.relaxation });
  if (s.scores?.resonance !== undefined) bars.push({ label: "Resonance", hint: "0.1 Hz power", value: s.scores.resonance });
  if (s.scores?.phase_lock != null) bars.push({ label: "Rhythm match", value: Math.round(s.scores.phase_lock * 100) });
  if (s.quality.good_pct != null) bars.push({ label: "Measurement quality", hint: "good channels", value: Math.round(s.quality.good_pct) });
  return bars;
}

export const ratingOf = (relaxation: number | undefined) =>
  relaxation === undefined ? null : relaxation >= 60 ? "Very good" : relaxation >= 40 ? "Good" : "Moderate";
