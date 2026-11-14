import type { CSSProperties } from "react";
import { GlassPanel } from "@/components/ui/Card";
import type { Source, VitalsMsg } from "@/api/types";
import { cx } from "@/lib/utils";
import { isLowConfidence } from "./labels";

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

function tiles(v: VitalsMsg | null, paced: boolean): Tile[] {
  const vs = v?.vs_baseline;
  const hrDelta = vs?.hr_delta_bpm;
  const rmDelta = vs?.rmssd_delta_pct;
  const rate = v?.resp.rate_bpm ?? null;
  const res = v?.resonance;
  const lock = v?.phase_lock;
  return [
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

/** Full set of 1 Hz vitals with confidence and the change versus the pre-exercise baseline. */
export function VitalsPanel({ vitals, paced }: { vitals: VitalsMsg | null; paced: boolean }) {
  return (
    <div className="vitals-grid">
      {tiles(vitals, paced).map((t) => (
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
