import { useState } from "react";
import type { Fitness, Summary } from "@/api/types";
import { CardHeader, GlassPanel, ProgressBar } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { cx, formatDuration } from "@/lib/utils";
import { fmt, shortDate, summaryBars, type MetricStat } from "./statsData";

// ------------------------------------------------------------------ sparkline

/** Tiny line of the last sessions, drawn inside a tile. */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="spark" />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - lo) / span) * 24}`);
  const last = pts[pts.length - 1].split(",");
  return (
    <svg className="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
    </svg>
  );
}

// ------------------------------------------------------------------ main trend chart

const W = 640;
const H = 230;
const PAD = { l: 44, r: 16, t: 14, b: 30 };

/** One metric over time with the user's own baseline as a dashed line. */
export function TrendCard({ stats }: { stats: MetricStat[] }) {
  const [key, setKey] = useState(stats[0]?.def.key);
  const stat = stats.find((s) => s.def.key === key) ?? stats[0];
  if (!stat) return null;
  const { def } = stat;
  const pts = stat.points.slice(-12);
  const vals = pts.map((p) => p.value);
  const base = stat.usual;
  const all = base === null ? vals : [...vals, base];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo || Math.abs(hi) * 0.2 || 1) * 0.2;
  lo -= pad;
  hi += pad;
  const x = (i: number) => PAD.l + (pts.length === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (pts.length - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];

  return (
    <GlassPanel as="article" className="stat-chart">
      <CardHeader
        caption="TREND"
        title={def.label}
        aside={base !== null && <span className="stat-base">average: {fmt(base, def.digits)}{def.unit}</span>}
      />
      <div className="chip-row" role="tablist">
        {stats.map((s) => (
          <button
            key={s.def.key}
            type="button"
            role="tab"
            aria-selected={s.def.key === def.key}
            className={cx("chip", s.def.key === def.key && "on")}
            style={{ "--tone": s.def.color } as React.CSSProperties}
            onClick={() => setKey(s.def.key)}
          >
            {s.def.label}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="stat-svg" role="img" aria-label={`Chart: ${def.label}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.l - 6} y={y(t) + 4} className="axis" textAnchor="end">{fmt(t, def.digits)}</text>
          </g>
        ))}
        {base !== null && <line x1={PAD.l} x2={W - PAD.r} y1={y(base)} y2={y(base)} stroke={def.color} strokeDasharray="6 5" opacity=".55" />}
        {pts.length > 1 && <path d={line} fill="none" stroke={def.color} strokeWidth="2.5" strokeLinejoin="round" />}
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={i === pts.length - 1 ? 6 : 4} fill={def.color} opacity={p.source === "simulated" ? 0.45 : 1}>
              <title>{`${shortDate(p.t)}: ${fmt(p.value, def.digits)}${def.unit}${p.source === "simulated" ? " (simulated)" : ""}`}</title>
            </circle>
            <text x={x(i)} y={H - 8} className="axis" textAnchor="middle">{shortDate(p.t)}</text>
          </g>
        ))}
      </svg>
    </GlassPanel>
  );
}

// ------------------------------------------------------------------ time of day

/** Mean resting heart rate per hour of the day (real recordings come from 4 sessions a day). */
export function HourCard({ hours }: { hours: { hour: number; value: number; n: number }[] }) {
  if (!hours.length) return null;
  const lo = Math.min(...hours.map((h) => h.value)) - 4;
  const hi = Math.max(...hours.map((h) => h.value));
  return (
    <GlassPanel as="article" className="hour-card">
      <CardHeader caption="TIME OF DAY" title="Resting heart rate through the day" />
      <div className="hour-bars">
        {hours.map((h) => (
          <div key={h.hour} className="hour-bar">
            <b>{h.value.toFixed(0)}</b>
            <i style={{ height: `${Math.max(8, ((h.value - lo) / (hi - lo || 1)) * 100)}%` }} />
            <small>{String(h.hour).padStart(2, "0")}:00</small>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

// ------------------------------------------------------------------ fitness

const COMPONENT_LABELS: Record<string, string> = {
  hr_rest_bpm: "Resting heart rate",
  activity_score: "Activity (survey)",
  // `missing` uses shorter keys than `components` (backend /fitness).
  hr_rest: "Resting heart rate",
  activity: "Activity (survey)",
  bmi: "BMI",
  age: "Age",
  sex: "Sex",
};

export function FitnessCard({ fitness }: { fitness: Fitness }) {
  return (
    <GlassPanel as="article" className="fitness-card">
      <CardHeader
        caption="FITNESS"
        title="Fitness (CRF)"
        aside={
          <div className="chart-score">
            <strong>{fmt(fitness.crf_mets, 1)} MET</strong>
          </div>
        }
      />
      <ul className="fit-list">
        {Object.entries(fitness.components).map(([k, c]) => (
          <li key={k}>
            <span>{COMPONENT_LABELS[k] ?? k}</span>
            <b>
              {c.value ?? "—"}
            </b>
          </li>
        ))}
        {fitness.hr_recovery && (
          <li>
            <span>
              Heart rate recovery <span className="sim-tag" title={fitness.hr_recovery.note}>SYM</span>
            </span>
            <b>{fitness.hr_recovery.drop_1min_bpm} bpm / min</b>
          </li>
        )}
      </ul>
      {fitness.missing.length > 0 && (
        <p className="empty-note">Missing data for a more accurate result: {fitness.missing.map((m) => COMPONENT_LABELS[m] ?? m).join(", ")}.</p>
      )}
    </GlassPanel>
  );
}

// ------------------------------------------------------------------ last session

export function SessionSummaryCard({ summary, ratingText }: { summary: Summary | null; ratingText: string | null }) {
  const bars = summary ? summaryBars(summary) : [];
  return (
    <GlassPanel as="article" className="summary-card">
      <CardHeader
        caption={`LAST SESSION${summary ? ` • ${formatDuration(Math.round(summary.duration_s))}` : ""}`}
        title="Session summary"
        aside={
          ratingText && (
            <span className="good-badge">
              <Icon name="check" size={14} /> {ratingText}
            </span>
          )
        }
      />
      <div className="summary-bars">
        {bars.map((bar) => (
          <div key={bar.label}>
            <span>{bar.label}</span>
            <ProgressBar value={bar.value} />
            <strong>{bar.value}%</strong>
          </div>
        ))}
        {!bars.length && <p className="empty-note">No finished session with results yet.</p>}
      </div>
    </GlassPanel>
  );
}
