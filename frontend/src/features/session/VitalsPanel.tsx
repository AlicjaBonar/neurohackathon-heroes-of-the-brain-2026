import { useRef, type CSSProperties } from "react";
import { GlassPanel } from "@/components/ui/Card";
import type { Source, VitalsMsg } from "@/api/types";
import { cx } from "@/lib/utils";
import { isLowConfidence } from "./labels";
import type { HoldRecord } from "./useLiveSession";

type Delta = { text: string; good: boolean } | null;

type Tile = {
  id: string;
  label: string;
  value: string;
  unit: string;
  color: string;
  delta: Delta;
  /** 0..1, shown as a bar; null when the source gives none. */
  confidence: number | null;
  note: string;
  source?: Source;
  dim?: boolean;
};

const fmt = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);
const signed = (v: number, unit: string) => `${v > 0 ? "+" : ""}${fmt(v, Number.isInteger(v) ? 0 : 1)}${unit}`;

const cyclesWord = (n: number) => (n === 1 ? "cycle" : "cycles");

/** Paced resonance breathing: 6 breaths/min (inhale 4.5 s, exhale 5.5 s). */
const TARGET_RATE = 6;

/** The standard 1 Hz vitals tiles, by id. */
function standardTiles(v: VitalsMsg | null, paced: boolean): Record<string, Tile> {
  const vs = v?.vs_baseline;
  const hrDelta = vs?.hr_delta_bpm;
  const rmDelta = vs?.rmssd_delta_pct;
  const rate = v?.resp.rate_bpm ?? null;
  const res = v?.resonance;
  const lock = v?.phase_lock;
  const list: Tile[] = [
    {
      id: "hr",
      label: "Heart rate",
      value: fmt(v?.hr.bpm),
      unit: " bpm",
      color: "#f43f5e",
      // Lower heart rate than at rest = calming down.
      delta: hrDelta === undefined ? null : { text: `${signed(hrDelta, "")} vs start`, good: hrDelta <= 0 },
      confidence: v?.hr.confidence ?? null,
      note: v?.hr.frozen ? "paused – motion" : `${v?.hr.window_s ?? 15} s window`,
      source: v?.hr.source,
      dim: !!v?.hr.frozen,
    },
    {
      id: "rmssd",
      label: "HRV • RMSSD",
      value: fmt(v?.hrv.rmssd_ms),
      unit: " ms",
      color: "#10b981",
      delta: rmDelta === undefined ? null : { text: `${signed(rmDelta, "%")} vs start`, good: rmDelta >= 0 },
      confidence: v?.hrv.confidence ?? null,
      note: v?.hrv.rmssd_ms ? `${v.hrv.window_s} s window` : "available after ~30 s",
      source: v?.hrv.source,
    },
    {
      id: "sdnn",
      label: "HRV • SDNN",
      value: fmt(v?.hrv.sdnn_ms),
      unit: " ms",
      color: "#0d9488",
      delta: null,
      confidence: v?.hrv.confidence ?? null,
      note: "overall variability",
      source: v?.hrv.source,
    },
    {
      id: "resp",
      label: "Breathing rate",
      value: fmt(rate, 1),
      unit: " /min",
      color: "#00a8c9",
      delta:
        paced && rate !== null
          ? { text: `target ${TARGET_RATE} /min`, good: Math.abs(rate - TARGET_RATE) <= 0.5 }
          : null,
      confidence: v?.resp.confidence ?? null,
      note: rate === null ? "breath hold or not enough data" : `${v?.resp.window_s ?? 60} s window`,
      source: v?.resp.source,
    },
    {
      id: "resonance",
      label: "Resonance 0.1 Hz",
      value: fmt(res?.score),
      unit: " /100",
      color: "#8b5cf6",
      delta:
        res?.power_0p1_rel !== undefined && res.baseline_rel !== undefined
          ? {
              text: `power ${fmt(res.power_0p1_rel * 100)}% vs ${fmt(res.baseline_rel * 100)}% at rest`,
              good: res.power_0p1_rel > res.baseline_rel,
            }
          : null,
      confidence: null,
      note: "0.07–0.13 Hz band power",
      source: res?.source,
    },
    {
      id: "lock",
      label: "Phase-lock",
      value: lock ? fmt(lock.value * 100) : "—",
      unit: "%",
      color: "#0b9a70",
      delta: lock ? { text: `${lock.cycles} ${cyclesWord(lock.cycles)}`, good: lock.value >= 0.6 } : null,
      confidence: null,
      note: lock ? "match with the target rhythm" : paced ? "available after the 2nd cycle" : "only during paced sets",
      source: lock?.source,
    },
  ];
  return Object.fromEntries(list.map((t) => [t.id, t]));
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="vital-confidence" title={`Measurement confidence: ${pct}%`}>
      <i>
        <b style={{ width: `${pct}%` }} />
      </i>
      <span>confidence {pct}%</span>
    </div>
  );
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
  const isMax = ctx.exercise === "breath_hold";
  const best = ctx.bestHoldS;
  const done = ctx.holds.filter((h) => h.endT !== null).length;
  return [
    {
      id: "hold",
      label: active ? "Holding" : "Hold time",
      value: fmt(holdS),
      unit: " s",
      color: "#0ea5e9",
      delta:
        isMax && best && holdS !== null && holdS > best
          ? { text: "new personal best!", good: true }
          : null,
      confidence: null,
      note: cur ? (active ? "breath hold in progress" : "last hold") : "starts with the first hold",
    },
    {
      id: "rise",
      label: "HbO rise",
      value: cur?.rise != null ? `${cur.rise >= 0 ? "+" : ""}${cur.rise.toFixed(2)}` : "—",
      unit: " µM",
      color: "#dc2626",
      delta: null,
      confidence: null,
      note: cur ? "oxygenated blood since the hold began" : "how the brain's blood supply reacts",
    },
    isMax
      ? {
          id: "best",
          label: "Your best",
          value: fmt(best),
          unit: best ? " s" : "",
          color: "#0f766e",
          delta: null,
          confidence: null,
          note: best ? "longest hold in earlier sessions" : "no earlier maximal hold",
        }
      : {
          id: "count",
          label: "Holds done",
          value: `${done}`,
          unit: ` / ${SHORT_HOLDS}`,
          color: "#0f766e",
          delta: null,
          confidence: null,
          note: active ? `hold ${ctx.holds.length} in progress` : done < SHORT_HOLDS ? "30 s of breathing between holds" : "all holds done",
        },
  ];
}

function recoveryTiles(ctx: ExerciseContext, v: VitalsMsg | null, minuteDrop: number | null): Tile[] {
  const inRecovery = ctx.phase === "hr_recovery";
  const el = inRecovery ? ctx.now - ctx.phaseStartT : 0;
  const bpm = v?.hr.bpm ?? null;
  const drop = inRecovery && ctx.hrPeak && bpm ? ctx.hrPeak.bpm - bpm : null;
  return [
    {
      id: "drop",
      label: "Drop from peak",
      value: drop === null ? "—" : drop.toFixed(0),
      unit: " bpm",
      color: "#f43f5e",
      delta: null,
      confidence: null,
      note: ctx.hrPeak ? `peak ${ctx.hrPeak.bpm.toFixed(0)} bpm` : "starts with the recovery",
    },
    {
      id: "minute",
      label: "1-minute drop",
      value: minuteDrop !== null ? minuteDrop.toFixed(0) : inRecovery ? `${Math.max(0, Math.ceil(RECOVERY_MARK_S - el))}` : "—",
      unit: minuteDrop !== null ? " bpm" : inRecovery ? " s left" : "",
      color: "#be123c",
      delta: minuteDrop !== null ? { text: minuteDrop >= 12 ? "healthy recovery (≥ 12 bpm)" : "below 12 bpm", good: minuteDrop >= 12 } : null,
      confidence: null,
      note: "classic fitness marker, measured at 60 s",
      source: "simulated",
    },
  ];
}

/** Exercise-specific set of live tiles: the vitals that matter for it plus its own results. */
export function VitalsPanel({ vitals, ctx }: { vitals: VitalsMsg | null; ctx: ExerciseContext }) {
  const paced = ctx.phase === "resonance_breathing";
  const std = standardTiles(vitals, paced);
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
    tiles = [...holdTiles(ctx), std.hr, std.rmssd, std.resp];
  } else if (ctx.exercise === "hr_recovery") {
    // Heart rate rises on purpose here, so no "vs start" warning on it.
    tiles = [{ ...std.hr, delta: null }, ...recoveryTiles(ctx, vitals, minuteRef.current.drop), std.rmssd, std.resp, std.sdnn];
  } else {
    tiles = [std.hr, std.rmssd, std.sdnn, std.resp, std.resonance, std.lock];
  }

  return (
    <div className="vitals-grid">
      {tiles.map((t) => (
        <GlassPanel
          as="article"
          key={t.id}
          className={cx("vital-tile", (t.dim || isLowConfidence(t.confidence ?? undefined)) && "low-confidence")}
          style={{ "--tone": t.color } as CSSProperties}
        >
          <small>
            {t.label}
            {t.source === "simulated" && <span className="sim-tag" title="Simulated value">SYM</span>}
          </small>
          <strong>
            {t.value}
            <em>{t.unit}</em>
          </strong>
          {t.delta && <span className={cx("vital-delta", t.delta.good ? "good" : "bad")}>{t.delta.text}</span>}
          <p>{t.note}</p>
          {t.confidence !== null && <ConfidenceBar value={t.confidence} />}
        </GlassPanel>
      ))}
    </div>
  );
}
