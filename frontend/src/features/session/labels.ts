import type { EventMsg } from "@/api/types";

export const PHASE_LABELS: Record<string, string> = {
  baseline_pre: "Pomiar spoczynkowy",
  baseline_post: "Pomiar po ćwiczeniu",
  resonance_breathing: "Oddech rezonansowy",
  short_holds: "Krótkie bezdechy",
  breath_hold: "Bezdech maksymalny",
  movement: "Wyzwanie ruchowe",
  hr_recovery: "Powrót tętna",
};

// ---- live session screen (English UI) ----

/** Phase names shown during the live session. */
export const SESSION_PHASE_LABELS: Record<string, string> = {
  baseline_pre: "Resting baseline",
  baseline_post: "Post-exercise baseline",
  resonance_breathing: "Resonance breathing",
  short_holds: "Short breath holds",
  breath_hold: "Maximal breath hold",
  movement: "Movement challenge",
  hr_recovery: "Heart rate recovery",
};

/** Exercise titles for the session header (the backend catalogue is in Polish). */
export const EXERCISE_TITLES: Record<string, string> = {
  resonance_breathing: "Resonance breathing 6/min",
  short_holds: "Short breath holds 7 × 10 s",
  breath_hold: "Maximal breath hold",
  movement: "Movement challenge",
  hr_recovery: "Heart rate recovery",
};

/** Signal-quality warnings by code (the backend text is in Polish). */
export const WARNING_TEXT: Record<string, string> = {
  motion: "Too much movement – sit comfortably and keep your head still",
  saturation: "Saturated channels – adjust the headband",
  weak_signal: "Weak signal – move hair away from the sensors",
};

export const GESTURE_LABELS: Record<string, string> = {
  nod: "nod your head",
  turn_left: "turn your head left",
  turn_right: "turn your head right",
  squat: "do a squat",
};

/** Short message for the events worth showing to the user; null for the rest. */
export function describeEvent(event: EventMsg): string | null {
  const data = event.data ?? {};
  switch (event.name) {
    case "hold_start":
      return "Breath hold – hold your breath";
    case "hold_end_detected":
      return `Inhale detected after ${Number(data.hold_s ?? 0).toFixed(0)} s`;
    case "command_issued":
      return `Task: ${GESTURE_LABELS[String(data.target)] ?? String(data.target)} (${data.reps}×)`;
    case "command_verified":
      return `Passed (${data.detected_reps}/${data.reps})`;
    case "command_failed":
      return "Try again";
    case "motion_warning":
      return "Too much movement – measurement paused";
    case "quality_warning":
      return "Signal quality dropped";
    default:
      return null;
  }
}

export const STAGE_LABELS = { inhale: "INHALE", exhale: "EXHALE", hold: "HOLD" } as const;

/** Greys out values the backend is not sure about (docs 0.1). */
export const isLowConfidence = (confidence: number | undefined) =>
  confidence !== undefined && confidence < 0.5;
