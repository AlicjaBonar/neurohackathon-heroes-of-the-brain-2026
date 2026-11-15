import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { Timeline } from "@/api/types";
import { formatDuration } from "@/lib/utils";

/** Phase bands and their names on the summary timeline. */
const PHASES: Record<string, { label: string; short: string; fill: string }> = {
  baseline_pre: { label: "Rest before", short: "Rest", fill: "rgba(13, 148, 136, 0.07)" },
  baseline_post: { label: "Rest after", short: "Rest", fill: "rgba(13, 148, 136, 0.07)" },
  resonance_breathing: { label: "Resonance breathing", short: "Exercise", fill: "rgba(139, 92, 246, 0.08)" },
  short_holds: { label: "Short holds", short: "Holds", fill: "rgba(14, 165, 233, 0.08)" },
  breath_hold: { label: "Maximal hold", short: "Hold", fill: "rgba(14, 165, 233, 0.08)" },
  hr_recovery: { label: "HR recovery", short: "Recovery", fill: "rgba(244, 63, 94, 0.07)" },
};

type Track = {
  key: "hr_bpm" | "resonance_score" | "breath_signal" | "hbo_uM";
  label: string;
  unit: string;
  color: string;
  digits: number;
  range?: [number, number];
  area?: boolean;
};

const ALL: Record<Track["key"], Track> = {
  hr_bpm: { key: "hr_bpm", label: "Heart rate", unit: " bpm", color: "#f43f5e", digits: 0 },
  resonance_score: { key: "resonance_score", label: "Resonance 0.1 Hz", unit: "/100", color: "#8b5cf6", digits: 0, range: [0, 100], area: true },
  breath_signal: { key: "breath_signal", label: "Breathing wave", unit: "", color: "#00b4d8", digits: 2 },
  hbo_uM: { key: "hbo_uM", label: "HbO (mean)", unit: " µM", color: "#dc2626", digits: 2 },
};

/** Tracks that tell the story of each exercise. */
function tracksFor(exercise: string, hasHbo: boolean): Track[] {
  const hbo = hasHbo ? [ALL.hbo_uM] : [];
  if (exercise === "resonance_breathing") return [ALL.hr_bpm, ALL.resonance_score, ALL.breath_signal];
  if (exercise === "short_holds" || exercise === "breath_hold") return [...hbo, ALL.hr_bpm, ALL.breath_signal];
  return [ALL.hr_bpm, ALL.breath_signal, ...hbo];
}

const W = 1000;
const TRACK_H = 70;
const GAP = 14;
const TOP = 26;

export function SessionTimeline({ timeline, exercise }: { timeline: Timeline; exercise: string }) {
  const { series, phases, events } = timeline;
  const TRACKS = tracksFor(exercise, !!series.hbo_uM?.some((v) => v !== null));
  const get = (k: Track["key"]) => series[k] ?? [];
  const t = series.t;
  const t0 = t[0] ?? 0;
  const t1 = t[t.length - 1] ?? 1;
  const x = (v: number) => ((v - t0) / (t1 - t0 || 1)) * W;
  const H = TOP + TRACKS.length * (TRACK_H + GAP);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const paths = useMemo(
    () =>
      TRACKS.map((tr, k) => {
        const vals = get(tr.key);
        const finite = vals.filter((v): v is number => v !== null && Number.isFinite(v));
        let [lo, hi] = tr.range ?? [Math.min(...finite), Math.max(...finite)];
        if (!tr.range) {
          const pad = Math.max((hi - lo) * 0.12, tr.key === "hr_bpm" ? 2 : tr.key === "hbo_uM" ? 0.05 : 0.2);
          lo -= pad;
          hi += pad;
        }
        const top = TOP + k * (TRACK_H + GAP);
        const y = (v: number) => top + (1 - (v - lo) / (hi - lo || 1)) * TRACK_H;
        let d = "";
        let pen = false;
        vals.forEach((v, i) => {
          if (v === null || !Number.isFinite(v)) {
            pen = false;
            return;
          }
          d += `${pen ? "L" : "M"}${x(t[i]).toFixed(1)} ${y(v).toFixed(1)}`;
          pen = true;
        });
        const area = tr.area && d ? `${d} L${x(t1)} ${top + TRACK_H} L${x(t0)} ${top + TRACK_H}Z` : null;
        return { tr, d, area, y, top, lo, hi };
      }),
    [series, t, t0, t1, exercise], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const marks = events.filter((e) => ["cycle", "hold_start", "hold_end_detected"].includes(e.name));

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    const tt = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < t.length; i++) if (Math.abs(t[i] - tt) < Math.abs(t[best] - tt)) best = i;
    setHover(best);
  };

  const hoverPhase = hover !== null ? series.phase[hover] : null;
  const hx = hover !== null ? x(t[hover]) : 0;

  return (
    <div className="timeline-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="timeline-svg"
        role="img"
        aria-label="Session timeline: heart rate, resonance and breathing over time"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {phases.map((p) => {
          const meta = PHASES[p.name] ?? { label: p.name, short: p.name, fill: "rgba(15,76,92,0.05)" };
          const a = x(Math.max(p.t0, t0));
          const b = x(Math.min(p.t1, t1));
          const w = b - a;
          // ~6.5 viewBox units per character; narrow bands get the short name or none.
          const label = w > meta.label.length * 6.5 + 12 ? meta.label : w > 44 ? meta.short : null;
          return (
            <g key={`${p.name}-${p.t0}`}>
              <rect x={a} y={0} width={Math.max(0, w)} height={H} fill={meta.fill} />
              <line x1={a} x2={a} y1={0} y2={H} className="tl-phase-edge" />
              {label && (
                <text x={a + w / 2} y={14} textAnchor="middle" className="tl-phase-label">
                  {label}
                </text>
              )}
            </g>
          );
        })}
        {paths.map(({ tr, d, area, top }) => (
          <g key={tr.key}>
            <line x1={0} x2={W} y1={top + TRACK_H} y2={top + TRACK_H} className="tl-base" />
            <text x={4} y={top + 11} className="tl-track-label" fill={tr.color}>
              {tr.label}
            </text>
            {area && <path d={area} fill={tr.color} opacity={0.12} />}
            {d && <path d={d} fill="none" stroke={tr.color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
          </g>
        ))}
        {marks.map((m, i) => (
          <circle
            key={i}
            cx={x(m.t)}
            cy={H - 6}
            r={m.name === "cycle" ? 2.5 : 4}
            className={m.name === "cycle" ? "tl-mark-cycle" : "tl-mark-hold"}
          />
        ))}
        {hover !== null && (
          <g>
            <line x1={hx} x2={hx} y1={0} y2={H} className="tl-cursor" />
            {paths.map(({ tr, y }) => {
              const v = get(tr.key)[hover];
              return v == null || !Number.isFinite(v) ? null : (
                <circle key={tr.key} cx={hx} cy={y(v)} r={4} fill="white" stroke={tr.color} strokeWidth={2} />
              );
            })}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="timeline-tip" style={{ left: `${(hx / W) * 100}%` }}>
          <strong>
            {formatDuration(Math.round(t[hover] - t0))}
            {hoverPhase && <span> • {PHASES[hoverPhase]?.label ?? hoverPhase}</span>}
          </strong>
          {TRACKS.map((tr) => {
            const v = get(tr.key)[hover];
            return (
              <span key={tr.key} style={{ color: tr.color }}>
                {tr.label}: <b>{v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(tr.digits)}${tr.unit}`}</b>
              </span>
            );
          })}
        </div>
      )}
      <div className="timeline-axis">
        <span>{formatDuration(0)}</span>
        <span>{formatDuration(Math.round((t1 - t0) / 2))}</span>
        <span>{formatDuration(Math.round(t1 - t0))}</span>
      </div>
      <div className="timeline-legend">
        <span><i className="dot cycle" /> breathing cycle</span>
        <span><i className="dot hold" /> breath hold start / end</span>
        <span>Shaded bands = session phases</span>
      </div>
    </div>
  );
}
