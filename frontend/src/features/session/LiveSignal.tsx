import { useState, type CSSProperties, type ReactNode } from "react";
import { CardHeader, GlassPanel } from "@/components/ui/Card";
import { cx } from "@/lib/utils";
import type { FrameMsg } from "@/api/types";
import { BUFFER, type SignalSample } from "./useLiveSession";

/** One toggleable signal layer of the live monitor. */
type LayerId = "breath" | "target" | "hbo" | "hbr" | "hr" | "motion" | "lock";

type Layer = {
  id: LayerId;
  label: string;
  color: string;
  unit: string;
  get: (s: SignalSample) => number | null;
  /** Smoothed version drawn bold over a thin raw line (HbO/HbR: without the cardiac pulse). */
  trend?: (s: SignalSample) => number | null;
  format: (v: number) => string;
  /** Fixed y range; otherwise auto-scaled over the window with at least `minSpan`. */
  range?: [number, number];
  minSpan?: number;
};

const LAYERS: Layer[] = [
  { id: "breath", label: "Breath (fNIRS)", color: "#00b4d8", unit: "", get: (s) => s.breath, format: (v) => v.toFixed(2), minSpan: 1.5 },
  { id: "target", label: "Target rhythm", color: "#f4a261", unit: "", get: (s) => s.target, format: (v) => (v < 0.5 ? "inhale" : "exhale"), range: [0, 1] },
  { id: "hbo", label: "HbO", color: "#dc2626", unit: " µM", get: (s) => s.hbo, trend: (s) => s.hboTrend, format: (v) => v.toFixed(2), minSpan: 0.2 },
  { id: "hbr", label: "HbR", color: "#6366f1", unit: " µM", get: (s) => s.hbr, trend: (s) => s.hbrTrend, format: (v) => v.toFixed(2), minSpan: 0.1 },
  { id: "hr", label: "Instant heart rate", color: "#db2777", unit: " bpm", get: (s) => s.hr, format: (v) => v.toFixed(0), minSpan: 8 },
  { id: "motion", label: "Motion", color: "#64748b", unit: "%", get: (s) => s.motion, format: (v) => (v * 100).toFixed(0), range: [0, 1] },
  { id: "lock", label: "Phase-lock", color: "#10b981", unit: "%", get: (s) => s.lock, format: (v) => (v * 100).toFixed(0), range: [0, 1] },
];
/**
 * HbO/HbR lanes, one line per chromophore:
 *  - mean of all good long channels, trend only (breathing, Mayer waves; no cardiac pulse);
 *  - strongest single channel with the pulse, like the device's own viewer.
 */
function hbMeanLayers(): Record<"hbo" | "hbr", Layer> {
  return {
    hbo: { ...BY_ID.hbo, get: (s) => s.hboTrend ?? s.hbo, trend: undefined },
    hbr: { ...BY_ID.hbr, get: (s) => s.hbrTrend ?? s.hbr, trend: undefined },
  };
}
function hbBestLayers(): Record<"hbo" | "hbr", Layer> {
  return {
    hbo: { ...BY_ID.hbo, get: (s) => s.best?.hbo ?? null, trend: undefined },
    hbr: { ...BY_ID.hbr, get: (s) => s.best?.hbr ?? null, trend: undefined },
  };
}

const BY_ID = Object.fromEntries(LAYERS.map((l) => [l.id, l])) as Record<LayerId, Layer>;

/** Layers that make sense for each exercise (the pacer and phase-lock exist only in resonance breathing). */
const AVAILABLE: Record<string, LayerId[]> = {
  resonance_breathing: ["breath", "target", "hbo", "hbr", "hr", "motion", "lock"],
  default: ["breath", "hbo", "hbr", "hr", "motion"],
};
const DEFAULT_ON: Record<string, LayerId[]> = {
  resonance_breathing: ["breath", "target", "hbo", "hbr", "hr", "lock"],
  short_holds: ["breath", "hbo", "hbr", "hr"],
  breath_hold: ["breath", "hbo", "hbr", "hr"],
  hr_recovery: ["hr", "breath", "hbo", "hbr"],
};
const storageKey = (exercise: string) => `live-layers:${exercise}`;

function loadLayers(exercise: string): Set<LayerId> {
  const allowed = AVAILABLE[exercise] ?? AVAILABLE.default;
  try {
    const raw = localStorage.getItem(storageKey(exercise));
    if (raw) return new Set((JSON.parse(raw) as LayerId[]).filter((id) => allowed.includes(id)));
  } catch {
    /* storage unavailable */
  }
  return new Set(DEFAULT_ON[exercise] ?? allowed);
}

const W = 600;
const PAD = 6;
const toX = (i: number, offset: number) => ((i + offset) / (BUFFER - 1)) * W;

/** SVG path through the samples; gaps (null) break the line. */
function pathOf(values: (number | null)[], offset: number, y: (v: number) => number) {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${toX(i, offset).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** Common y range for the series of one lane (fixed range, or auto-scaled over all of them). */
function scaleOf(series: Layer[], values: (number | null)[][]): [number, number] {
  const fixed = series.find((l) => l.range)?.range;
  if (fixed) return fixed;
  const finite = values.flat().filter((v): v is number => v !== null && Number.isFinite(v));
  if (!finite.length) return [0, 1];
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const span = Math.max(hi - lo, ...series.map((l) => l.minSpan ?? 0)) * 1.1;
  const mid = (lo + hi) / 2;
  return [mid - span / 2, mid + span / 2];
}

function lastValue(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return values[i];
  return null;
}

/**
 * One horizontal strip. All `series` share one y scale (e.g. HbO and HbR in µM);
 * the optional pacer `overlay` keeps its own 0..1 scale.
 */
function Lane({
  samples,
  series,
  overlay,
  height: LANE_H = 64,
  extra,
}: {
  samples: SignalSample[];
  series: Layer[];
  overlay?: Layer;
  height?: number;
  /** Controls shown in the lane's top-right corner. */
  extra?: ReactNode;
}) {
  const offset = BUFFER - samples.length;
  // A gap sample (phase change) breaks every line instead of joining two recordings with a jump.
  const read = (f: (s: SignalSample) => number | null) => samples.map((s) => (s.gap ? null : f(s)));
  const values = series.map((l) => read(l.get));
  const trends = series.map((l) => (l.trend ? read(l.trend) : null));
  const gaps = samples.flatMap((s, i) => (s.gap ? [toX(i, offset)] : []));
  const hasTrend = trends.map((t) => !!t && t.some((v) => v !== null));
  const [lo, hi] = scaleOf(series, values);
  const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo || 1)) * (LANE_H - 2 * PAD);
  const zeroInside = !series[0].range && lo < 0 && hi > 0;
  const baseY = zeroInside ? y(0) : LANE_H / 2;
  const yt = (v: number) => PAD + (1 - v) * (LANE_H - 2 * PAD);
  const overlayPath = overlay ? pathOf(read(overlay.get), offset, yt) : "";
  const shown = [...series, ...(overlay ? [overlay] : [])];

  return (
    <div className="signal-lane">
      {extra && <div className="lane-extra">{extra}</div>}
      <div className="lane-label">
        {shown.map((l) => {
          const v = lastValue(samples.map(l.get));
          return (
            <span key={l.id} style={{ color: l.color }}>
              <i style={{ background: l.color }} />
              {l.label}
              <b>{v === null ? "—" : `${l.format(v)}${l.unit}`}</b>
            </span>
          );
        })}
      </div>
      <svg viewBox={`0 0 ${W} ${LANE_H}`} style={{ height: LANE_H }} preserveAspectRatio="none" aria-label={shown.map((l) => l.label).join(", ")}>
        <line x1="0" x2={W} y1={baseY} y2={baseY} className="lane-mid" />
        {gaps.map((x) => (
          <line key={x} x1={x} x2={x} y1="0" y2={LANE_H} className="lane-gap" />
        ))}
        {overlayPath && (
          <path d={overlayPath} fill="none" stroke={overlay!.color} strokeWidth="2" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
        )}
        {series.map((l, k) => {
          const d = pathOf(values[k], offset, y);
          const now = lastValue(values[k]);
          return (
            <g key={l.id}>
              {l.id === "motion" && d && (
                <path d={`${d} L${W} ${LANE_H} L${toX(0, offset)} ${LANE_H}Z`} fill={l.color} opacity=".15" />
              )}
              {d && (
                <path
                  d={d}
                  fill="none"
                  stroke={l.color}
                  strokeWidth={hasTrend[k] ? 1.1 : 2.2}
                  opacity={hasTrend[k] ? 0.4 : 1}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                />
              )}
              {hasTrend[k] && (
                <path
                  d={pathOf(trends[k]!, offset, y)}
                  fill="none"
                  stroke={l.color}
                  strokeWidth="2.6"
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                />
              )}
              {now !== null && (
                <circle cx={W - 1} cy={y(now)} r="3.5" fill="white" stroke={l.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function LiveSignalCard({
  samples,
  exercise,
  scoreLabel,
  score,
  stage,
  footer,
  hb,
}: {
  exercise: string;
  /** Latest frame's HbO/HbR block: channel count of the mean and the strongest channel. */
  hb?: FrameMsg["hb"];
  samples: SignalSample[];
  /** Score badge in the corner; omitted for exercises without a live score. */
  scoreLabel?: string;
  score?: number | null;
  stage: string;
  footer?: ReactNode;
}) {
  const [on, setOn] = useState<Set<LayerId>>(() => loadLayers(exercise));
  const available = AVAILABLE[exercise] ?? AVAILABLE.default;

  const toggle = (id: LayerId) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(storageKey(exercise), JSON.stringify([...next]));
      } catch {
        /* storage unavailable */
      }
      return next;
    });

  // The pacer target rides on the breathing lane so you can see whether you keep up with it.
  const lanes: { key: string; series: Layer[]; overlay?: Layer; height?: number; extra?: ReactNode }[] = [];
  if (on.has("breath")) lanes.push({ key: "breath", series: [BY_ID.breath], overlay: on.has("target") ? BY_ID.target : undefined });
  else if (on.has("target")) lanes.push({ key: "target", series: [BY_ID.target] });
  // HbO and HbR on one common µM scale, so their opposite swings are comparable.
  const hbIds = (["hbo", "hbr"] as const).filter((id) => on.has(id));
  const best = hb?.best;
  if (hbIds.length) {
    const mean = hbMeanLayers();
    lanes.push({
      key: "hb-mean",
      series: hbIds.map((id) => mean[id]),
      height: 80,
      extra: <span className="lane-tag" title="Average of all good long channels, cardiac pulse filtered out">
        Mean{hb?.n_channels ? ` of ${hb.n_channels} channels` : ""} • trend
      </span>,
    });
    if (best) {
      const one = hbBestLayers();
      lanes.push({
        key: "hb-best",
        series: hbIds.map((id) => one[id]),
        height: 80,
        extra: <span className="lane-tag" title={`Best SCI ${best.sci.toFixed(2)}; raw signal with the cardiac pulse`}>
          Strongest channel {best.pair} • {best.label} • with pulse
        </span>,
      });
    }
  }
  for (const id of ["hr", "motion", "lock"] as const) if (on.has(id)) lanes.push({ key: id, series: [BY_ID[id]] });

  return (
    <GlassPanel as="article" className="live-chart-card">
      <CardHeader
        caption="LIVE SIGNALS • LAST 30 S"
        title={stage ? `Monitor • ${stage.toLowerCase()}` : "Monitor"}
        aside={
          scoreLabel && <div className="coherence">
            <small>{scoreLabel}</small>
            <strong>{score == null ? "—" : `${score}%`}</strong>
          </div>
        }
      />
      <div className="layer-toggles" role="group" aria-label="Signal layers">
        {LAYERS.filter((l) => available.includes(l.id)).map((l) => (
          <button
            key={l.id}
            type="button"
            className={cx("layer-chip", on.has(l.id) && "on")}
            aria-pressed={on.has(l.id)}
            onClick={() => toggle(l.id)}
            style={{ "--chip": l.color } as CSSProperties}
          >
            <i />
            {l.label}
          </button>
        ))}
      </div>
      <div className="signal-lanes">
        {lanes.length ? (
          lanes.map(({ key, ...lane }) => <Lane key={key} samples={samples} {...lane} />)
        ) : (
          <p className="empty-note">Turn on at least one signal layer.</p>
        )}
        {lanes.length > 0 && (
          <div className="lane-axis">
            <span>−30 s</span>
            <span>−15 s</span>
            <span>now</span>
          </div>
        )}
      </div>
      {footer && <div className="signal-footer">{footer}</div>}
    </GlassPanel>
  );
}
