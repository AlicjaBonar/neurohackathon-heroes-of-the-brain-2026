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
  /** Optional bar along the bottom of the card. */
  meter?: { label: string; value: number };
};

export const METRICS: Metric[] = [
  {
    tone: "heart",
    icon: "heart",
    iconSize: 24,
    label: "TĘTNO SPOCZYNKOWE",
    value: "61",
    unit: " BPM",
    trend: { direction: "down", value: "3", note: "vs. poprzedni tydzień" },
    side: { label: "HRR 60s", value: "-24", unit: "BPM/min" },
  },
  {
    tone: "hrv",
    icon: "wave",
    iconSize: 24,
    label: "HRV • RMSSD",
    value: "56",
    unit: " ms",
    trend: { direction: "up", value: "+21%", note: "bardzo dobra zmiana" },
    side: { label: "CZAS FLOW", value: "42", unit: "sekundy" },
  },
  {
    tone: "lung",
    icon: "lungs",
    iconSize: 25,
    label: "POJEMNOŚĆ PŁUC",
    value: "78",
    unit: "/100 pkt",
    trend: { direction: "up", value: "+6 pkt", note: "w tym miesiącu" },
    side: { label: "MAKS. BEZDECH", value: "44", unit: "sekundy" },
    meter: { label: "Ekonomia O₂", value: 82 },
  },
];

export const FLOW_TREND = {
  values: [38, 53, 47, 68, 59, 74, 84],
  days: ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Dziś"],
  current: 84,
  change: { direction: "up" as TrendDirection, value: "12%" },
};

export const LAST_SESSION = {
  duration: "12:42 MIN",
  rating: "Bardzo dobra",
  bars: [
    { label: "Spokój kory", hint: "ΔHbO/ΔHbR", value: 84 },
    { label: "Stabilność aux", value: 92 },
  ],
};
