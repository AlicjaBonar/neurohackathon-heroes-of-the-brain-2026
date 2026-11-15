import { useRef, type CSSProperties } from "react";
import { GlassPanel } from "@/components/ui/Card";
import type { VitalsMsg } from "@/api/types";
import type { HoldRecord } from "./useLiveSession";

/** A live tile shows only the metric name, its value and the unit. */
type Tile = {
  id: string;
  label: string;
  value: string;
  unit: string;
  color: string;
};

const fmt = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);

/** The standard 1 Hz vitals tiles, by id. */
function standardTiles(v: VitalsMsg | null): Record<"hr" | "hrv" | "resp", Tile> {
  return {
    hr: { id: "hr", label: "Heart rate", value: fmt(v?.hr.bpm), unit: " bpm", color: "#f43f5e" },
    hrv: { id: "hrv", label: "HRV", value: fmt(v?.hrv.rmssd_ms), unit: " ms", color: "#10b981" },
    resp: { id: "resp", label: "Breathing rate", value: fmt(v?.resp.rate_bpm, 1), unit: " /min", color: "#00a8c9" },
  };
}

/** Live context the exercise-specific tiles need besides the vitals. */
export type ExerciseContext = {
  exercise: string;
  phase: string | null;
  /** Current stream time and the start of the current phase (s). */
  now: number;
  phaseStartT: number;
  holds: HoldRecord[];
  /** Personal best maximal hold from earlier sessions (s). */
  bestHoldS: number | null;
  hrPeak: { bpm: number; t: number } | null;
};

const SHORT_HOLDS = 7;
const RECOVERY_MARK_S = 60;

function holdTiles(ctx: ExerciseContext): Tile[] {
  const cur = ctx.holds[ctx.holds.length - 1];
  const active = cur && cur.endT === null;
  const holdS = cur ? (active ? ctx.now - cur.startT : cur.holdS) : null;
  const done = ctx.holds.filter((h) => h.endT !== null).length;
  return [
    { id: "hold", label: "Hold time", value: fmt(holdS), unit: " s", color: "#0ea5e9" },
    {
      id: "rise",
      label: "HbO rise",
      value: cur?.rise != null ? `${cur.rise >= 0 ? "+" : ""}${cur.rise.toFixed(2)}` : "—",
      unit: " µM",
      color: "#dc2626",
    },
    ctx.exercise === "breath_hold"
      ? { id: "best", label: "Your best", value: fmt(ctx.bestHoldS), unit: " s", color: "#0f766e" }
      : { id: "count", label: "Holds done", value: `${done}`, unit: ` / ${SHORT_HOLDS}`, color: "#0f766e" },
  ];
}

function recoveryTiles(ctx: ExerciseContext, v: VitalsMsg | null, minuteDrop: number | null): Tile[] {
  const bpm = v?.hr.bpm ?? null;
  const drop = ctx.phase === "hr_recovery" && ctx.hrPeak && bpm ? ctx.hrPeak.bpm - bpm : null;
  return [
    { id: "drop", label: "Drop from peak", value: fmt(drop), unit: " bpm", color: "#f43f5e" },
    { id: "minute", label: "1-minute drop", value: fmt(minuteDrop), unit: " bpm", color: "#be123c" },
  ];
}

/** Exercise-specific set of live tiles: the vitals that matter for it plus its own results. */
export function VitalsPanel({ vitals, ctx }: { vitals: VitalsMsg | null; ctx: ExerciseContext }) {
  const std = standardTiles(vitals);
  // HR recovery: freeze the drop from the peak once 60 s have passed.
  const minuteRef = useRef<{ phaseStart: number; drop: number | null }>({ phaseStart: -1, drop: null });
  if (ctx.phase === "hr_recovery") {
    if (minuteRef.current.phaseStart !== ctx.phaseStartT) minuteRef.current = { phaseStart: ctx.phaseStartT, drop: null };
    const bpm = vitals?.hr.bpm;
    if (minuteRef.current.drop === null && ctx.now - ctx.phaseStartT >= RECOVERY_MARK_S && ctx.hrPeak && bpm) {
      minuteRef.current.drop = ctx.hrPeak.bpm - bpm;
    }
  }

  let tiles: Tile[];
  if (ctx.exercise === "short_holds" || ctx.exercise === "breath_hold") {
    tiles = [...holdTiles(ctx), std.hr, std.hrv, std.resp];
  } else if (ctx.exercise === "hr_recovery") {
    tiles = [std.hr, ...recoveryTiles(ctx, vitals, minuteRef.current.drop), std.hrv, std.resp];
  } else {
    tiles = [std.hr, std.hrv, std.resp];
  }

  return (
    <div className="vitals-grid">
      {tiles.map((t) => (
        <GlassPanel as="article" key={t.id} className="vital-tile" style={{ "--tone": t.color } as CSSProperties}>
          <small>{t.label}</small>
          <strong>
            {t.value}
            <em>{t.unit}</em>
          </strong>
        </GlassPanel>
      ))}
    </div>
  );
}
