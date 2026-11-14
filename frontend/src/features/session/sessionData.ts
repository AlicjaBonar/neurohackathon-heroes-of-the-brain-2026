import type { TrendDirection } from "@/lib/utils";

export type SessionMode = {
  title: string;
  description: string;
  duration: string;
};

export const SESSION_MODES: SessionMode[] = [
  {
    title: "Rozgrzewka przed treningiem",
    description: "Aktywacja układu nerwowego",
    duration: "5 min",
  },
  {
    title: "Podczas treningu",
    description: "Koherencja i kontrola wysiłku",
    duration: "Na żywo",
  },
  {
    title: "Cool-down",
    description: "Regeneracja i powrót do równowagi",
    duration: "8 min",
  },
];

export const DEFAULT_SESSION_MODE = SESSION_MODES[2];

export type LiveMetric = {
  tone: "hrv" | "hr" | "aux";
  label: string;
  direction: TrendDirection;
  value: string;
  unit: string;
  note: string;
};

export const LIVE_METRICS: LiveMetric[] = [
  {
    tone: "hrv",
    label: "HRV",
    direction: "up",
    value: "+12",
    unit: " ms",
    note: "rosnąca zmienność",
  },
  {
    tone: "hr",
    label: "TĘTNO",
    direction: "down",
    value: "-8",
    unit: " BPM",
    note: "spokojny spadek",
  },
  {
    tone: "aux",
    label: "RUCH AUX",
    direction: "down",
    value: "-35",
    unit: "%",
    note: "wysoka stabilność",
  },
];
