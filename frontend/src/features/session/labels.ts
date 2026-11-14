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

export const GESTURE_LABELS: Record<string, string> = {
  nod: "kiwnij głową",
  turn_left: "obróć głowę w lewo",
  turn_right: "obróć głowę w prawo",
  squat: "zrób przysiad",
};

/** Short Polish message for the events worth showing to the user; null for the rest. */
export function describeEvent(event: EventMsg): string | null {
  const data = event.data ?? {};
  switch (event.name) {
    case "hold_start":
      return "Bezdech – wstrzymaj oddech";
    case "hold_end_detected":
      return `Wykryto wdech po ${Number(data.hold_s ?? 0).toFixed(0)} s`;
    case "command_issued":
      return `Polecenie: ${GESTURE_LABELS[String(data.target)] ?? String(data.target)} (${data.reps}×)`;
    case "command_verified":
      return `Zaliczone (${data.detected_reps}/${data.reps})`;
    case "command_failed":
      return "Spróbuj jeszcze raz";
    case "motion_warning":
      return "Za dużo ruchu – pomiar wstrzymany";
    case "quality_warning":
      return "Pogorszyła się jakość sygnału";
    default:
      return null;
  }
}

export const STAGE_LABELS = { inhale: "WDECH", exhale: "WYDECH", hold: "BEZDECH" } as const;

/** Greys out values the backend is not sure about (docs 0.1). */
export const isLowConfidence = (confidence: number | undefined) =>
  confidence !== undefined && confidence < 0.5;
