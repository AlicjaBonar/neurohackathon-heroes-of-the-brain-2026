import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/backend";
import type { ChannelQuality, ChannelsMsg, Probe } from "@/api/types";
import { CardHeader, GlassPanel } from "@/components/ui/Card";
import { cx } from "@/lib/utils";
import { BrainScene, type HoverInfo } from "./brainScene";
import { LEGEND_GRADIENT } from "./colormap";
import { TopoMap } from "./TopoMap";

type Mode = "hbo" | "hbr" | "coupling";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "hbo", label: "HbO", hint: "Oxygenated haemoglobin change" },
  { id: "hbr", label: "HbR", hint: "Deoxygenated haemoglobin change (same µM scale as HbO)" },
  { id: "coupling", label: "Breath coupling", hint: "Correlation of HbO with your breathing, last 30 s" },
];

/** 2 Hz channel messages kept for the breath-coupling map (30 s). */
const HISTORY = 60;
/** Lags tried between breathing and HbO (0–3 s at 2 Hz); HbO follows the breath with a delay. */
const MAX_LAG = 6;

function pearson(a: number[], b: number[]) {
  const n = a.length;
  if (n < 8) return null;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    sab += x * y; saa += x * x; sbb += y * y;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}

/** Per channel: correlation of HbO with breathing at the lag where it is strongest. */
function coupling(history: { hbo: (number | null)[]; breath: number }[], nCh: number) {
  const out: (number | null)[] = [];
  for (let c = 0; c < nCh; c++) {
    let best: number | null = null;
    for (let lag = 0; lag <= MAX_LAG; lag++) {
      const a: number[] = [], b: number[] = [];
      for (let i = lag; i < history.length; i++) {
        const v = history[i].hbo[c];
        if (v === null || v === undefined) continue;
        a.push(v);
        b.push(history[i - lag].breath);
      }
      const r = pearson(a, b);
      if (r !== null && (best === null || Math.abs(r) > Math.abs(best))) best = r;
    }
    out.push(best);
  }
  return out;
}

const fmt = (v: number | null | undefined, unit: string, digits = 2) =>
  v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}${unit}`;

export function BrainMapCard({
  sessionId,
  channels,
  qualityChannels,
  breath,
}: {
  sessionId: string | null;
  channels: ChannelsMsg | null;
  qualityChannels: ChannelQuality[] | undefined;
  /** Latest breathing-wave value (for the coupling map). */
  breath: number | null;
}) {
  const [probe, setProbe] = useState<Probe | null>(null);
  const [mode, setMode] = useState<Mode>("hbo");
  const [showHead, setShowHead] = useState(true);
  const [hover, setHover] = useState<(HoverInfo & { view: "3d" | "2d" }) | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BrainScene | null>(null);
  const history = useRef<{ hbo: (number | null)[]; breath: number }[]>([]);
  const lastMsgAt = useRef(0);
  const breathRef = useRef(breath);
  breathRef.current = breath;

  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    api.probe(sessionId).then((p) => alive && setProbe(p)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sessionId]);

  // The three.js scene lives for the whole card.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new BrainScene(canvas, (h) => setHover(h && { ...h, view: "3d" }));
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (probe) sceneRef.current?.setProbe(probe);
  }, [probe]);

  useEffect(() => {
    sceneRef.current?.setHeadVisible(showHead);
  }, [showHead]);

  // Collect history for the coupling map.
  useEffect(() => {
    if (!channels) return;
    lastMsgAt.current = performance.now();
    if (breathRef.current !== null) {
      history.current = [...history.current, { hbo: channels.hbo, breath: breathRef.current }].slice(-HISTORY);
    }
  }, [channels]);

  // Detect pauses in the channel stream (simulated phases of a replay have no map).
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const stale = !!channels && now - lastMsgAt.current > 2500;

  const { values, scale, unit } = useMemo(() => {
    if (!channels) return { values: [] as (number | null)[], scale: 1, unit: " µM" };
    if (mode === "coupling") return { values: coupling(history.current, channels.hbo.length), scale: 1, unit: "" };
    return { values: mode === "hbo" ? channels.hbo : channels.hbr, scale: channels.scale_uM, unit: " µM" };
  }, [channels, mode]);

  useEffect(() => {
    sceneRef.current?.setValues(values, scale);
  }, [values, scale]);

  const sci = useMemo(() => new Map((qualityChannels ?? []).map((q) => [q.pair, q])), [qualityChannels]);
  const longPairs = probe?.pairs.filter((p) => !p.short) ?? [];
  const valid = longPairs.filter((p) => values[p.index] !== null && values[p.index] !== undefined);
  const peak = (sign: 1 | -1) =>
    valid.reduce<{ label: string; v: number } | null>((best, p) => {
      const v = values[p.index]!;
      return v * sign > 0 && (!best || v * sign > best.v * sign) ? { label: p.label, v } : best;
    }, null);
  const up = peak(1);
  const down = peak(-1);
  const hovered = hover && probe ? probe.pairs[hover.index] : null;
  const hq = hovered ? sci.get(hovered.pair) : undefined;
  const isCoupling = mode === "coupling";
  const couplingReady = history.current.length >= 12;

  return (
    <GlassPanel as="article" className="brain-card">
      <CardHeader
        caption={`BRAIN MAP • fNIRS ${probe ? `• ${longPairs.length} CHANNELS` : ""}`}
        title="Cortical activity"
        aside={
          <div className="brain-controls">
            <div className="segmented" role="radiogroup" aria-label="Map signal">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  title={m.hint}
                  className={cx(mode === m.id && "on")}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <label className="head-toggle">
              <input type="checkbox" checked={showHead} onChange={(e) => setShowHead(e.target.checked)} />
              Head &amp; optodes
            </label>
          </div>
        }
      />
      <div className="brain-body">
        <div className="brain-3d">
          <canvas ref={canvasRef} aria-label="3D brain with the live channel map; drag to rotate, scroll to zoom" />
          <span className="brain-hint">Drag to rotate • scroll to zoom</span>
          {(!channels || stale) && (
            <div className="brain-overlay">
              {!channels ? "Waiting for channel data…" : "Map paused – no channel data in this phase"}
            </div>
          )}
          {hover?.view === "3d" && hovered && (
            <ChannelTooltip x={hover.x} y={hover.y} pair={hovered} q={hq} channels={channels} mode={mode} value={values[hovered.index]} />
          )}
        </div>
        <div className="brain-side">
          <div className="topo-wrap">
            {probe && (
              <TopoMap probe={probe} values={values} scale={scale} onHover={(h) => setHover(h && { ...h, view: "2d" })} />
            )}
            {hover?.view === "2d" && hovered && (
              <ChannelTooltip x={hover.x} y={hover.y} pair={hovered} q={hq} channels={channels} mode={mode} value={values[hovered.index]} />
            )}
          </div>
          <div className="brain-legend">
            <div className="legend-bar" style={{ background: LEGEND_GRADIENT }} />
            <div className="legend-ticks">
              <span>{isCoupling ? "−1" : `−${scale.toFixed(2)} µM`}</span>
              <span>{isCoupling ? "r = 0" : "0"}</span>
              <span>{isCoupling ? "+1" : `+${scale.toFixed(2)} µM`}</span>
            </div>
            <p>
              {isCoupling
                ? couplingReady
                  ? "Red: HbO rises with each breath. Blue: it moves against it."
                  : "Collecting 6 s of data…"
                : mode === "hbo"
                  ? "Red: more oxygenated blood than average. Blue: less."
                  : "HbR usually mirrors HbO with a smaller, opposite swing."}
            </p>
          </div>
          <dl className="brain-stats">
            <div>
              <dt>Strongest ↑</dt>
              <dd>{up ? `${up.label} ${fmt(up.v, unit)}` : "—"}</dd>
            </div>
            <div>
              <dt>Strongest ↓</dt>
              <dd>{down ? `${down.label} ${fmt(down.v, unit)}` : "—"}</dd>
            </div>
            <div>
              <dt>Valid channels</dt>
              <dd>
                {valid.length} / {longPairs.length}
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{channels ? (channels.source === "simulated" ? "simulated" : "recording") : "—"}</dd>
            </div>
          </dl>
        </div>
      </div>
    </GlassPanel>
  );
}

function ChannelTooltip({
  x,
  y,
  pair,
  q,
  channels,
  mode,
  value,
}: {
  x: number;
  y: number;
  pair: Probe["pairs"][number];
  q: ChannelQuality | undefined;
  channels: ChannelsMsg | null;
  mode: Mode;
  value: number | null | undefined;
}) {
  return (
    <div className="channel-tooltip" style={{ left: x + 14, top: y + 14 }} role="tooltip">
      <strong>
        {pair.pair} <span>• {pair.label}</span>
      </strong>
      <dl>
        <dt>HbO</dt>
        <dd>{fmt(channels?.hbo[pair.index], " µM")}</dd>
        <dt>HbR</dt>
        <dd>{fmt(channels?.hbr[pair.index], " µM")}</dd>
        {mode === "coupling" && (
          <>
            <dt>Breath r</dt>
            <dd>{fmt(value, "")}</dd>
          </>
        )}
        <dt>Distance</dt>
        <dd>{pair.distance_mm.toFixed(1)} mm</dd>
        <dt>SCI</dt>
        <dd className={cx("status", q?.status)}>{q ? `${q.sci.toFixed(2)} • ${q.status}` : "—"}</dd>
      </dl>
    </div>
  );
}
