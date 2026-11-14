import type { Dashboard, Readiness, SeriesPoint, Summary } from "@/api/types";
import type { IconName } from "@/components/ui/Icon";
import type { TrendDirection } from "@/lib/utils";

export type Metric = {
  tone: "heart" | "hrv" | "lung";
  icon: IconName;
  iconSize: number;
  label: string;
  value: string;
  unit: string;
  trend: { direction: TrendDirection; value: string; note: string };
  side: { label: string; value: string; unit: string };
  simulated: boolean;
};

const fmt = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined ? "—" : value.toFixed(digits);

function trendOf(r: Readiness | null | undefined, unit: string): Metric["trend"] {
  if (!r || r.delta === null) return { direction: "down", value: "—", note: "za mało sesji na linię bazową" };
  return {
    direction: r.delta <= 0 ? "down" : "up",
    value: `${Math.abs(r.delta)}${unit}`,
    note: "vs. Twoja średnia z ostatnich sesji",
  };
}

export function buildMetrics(d: Dashboard): Metric[] {
  const { hr_rest: hr, rmssd } = d.readiness;
  return [
    {
      tone: "heart",
      icon: "heart",
      iconSize: 24,
      label: "TĘTNO SPOCZYNKOWE",
      value: fmt(hr?.value),
      unit: " BPM",
      trend: trendOf(hr, " BPM"),
      side: { label: "FORMA (CRF)", value: fmt(d.fitness.crf_mets, 1), unit: "MET" },
      simulated: hr?.source === "simulated",
    },
    {
      tone: "hrv",
      icon: "wave",
      iconSize: 24,
      label: "HRV • RMSSD",
      value: fmt(rmssd?.value),
      unit: " ms",
      trend: trendOf(rmssd, " ms"),
      side: { label: "REKORD REZONANSU", value: fmt(d.records.resonance_score?.value), unit: "/100" },
      simulated: rmssd?.source === "simulated",
    },
    {
      tone: "lung",
      icon: "lungs",
      iconSize: 25,
      label: "NAJDŁUŻSZY BEZDECH",
      value: fmt(d.records.hold_s?.value),
      unit: " s",
      trend: { direction: "up", value: "rekord", note: "z wszystkich sesji" },
      side: { label: "SESJE", value: String(d.last_sessions.length), unit: "ostatnie" },
      simulated: d.records.hold_s?.source === "simulated",
    },
  ];
}

const DATE = new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit" });

/** Last 7 points of a 0-100 series as chart input. */
export function trendOf7(series: SeriesPoint[]) {
  const last = series.slice(-7);
  const values = last.map((p) => Math.max(0, Math.min(100, p.value)));
  const labels = last.map((p) => DATE.format(new Date(p.t)));
  const first = values[0];
  const current = values.length ? Math.round(values[values.length - 1]) : null;
  const change =
    values.length > 1 && first
      ? { direction: (values[values.length - 1] >= first ? "up" : "down") as TrendDirection,
          value: `${Math.abs(Math.round(((values[values.length - 1] - first) / first) * 100))}%` }
      : null;
  return { values, labels, current, change };
}

export function summaryBars(s: Summary) {
  const bars: { label: string; hint?: string; value: number }[] = [];
  if (s.scores?.relaxation !== undefined) bars.push({ label: "Relaksacja", value: s.scores.relaxation });
  if (s.scores?.resonance !== undefined) bars.push({ label: "Rezonans", hint: "moc 0,1 Hz", value: s.scores.resonance });
  if (s.scores?.phase_lock != null) bars.push({ label: "Zgodność z rytmem", value: Math.round(s.scores.phase_lock * 100) });
  if (s.quality.good_pct != null) bars.push({ label: "Jakość pomiaru", hint: "dobre kanały", value: Math.round(s.quality.good_pct) });
  return bars;
}

export const ratingOf = (relaxation: number | undefined) =>
  relaxation === undefined ? null : relaxation >= 60 ? "Bardzo dobra" : relaxation >= 40 ? "Dobra" : "Umiarkowana";
