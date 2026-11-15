import { useEffect, useState } from "react";
import { api } from "@/api/backend";
import type { Insight, Summary, Timeline } from "@/api/types";
import { AppShell, StatusPill } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { CardHeader, GlassPanel } from "@/components/ui/Card";
import { ScreenTitle } from "@/components/ui/Page";
import { cx, formatDuration } from "@/lib/utils";
import { EXERCISE_TITLES } from "./labels";
import { SessionTimeline } from "./SessionTimeline";
import { buildInsights, relaxationVerdict } from "./summaryInsights";

const fmt = (v: number | null | undefined, digits = 0) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits));
const signed = (v: number, digits = 0) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;

// ------------------------------------------------------------------ main score

type Score = { value: number; label: string; verdict: string; note: string };

function mainScore(s: Summary): Score | null {
  const sc = s.scores;
  if (sc?.relaxation != null) {
    return {
      value: sc.relaxation,
      label: "Relaxation score",
      verdict: relaxationVerdict(sc.relaxation),
      note: "From the change in heart rate and HRV between the rest before and after, plus resonance.",
    };
  }
  if (sc?.phase_lock != null) {
    const v = Math.round(sc.phase_lock * 100);
    return { value: v, label: "Rhythm match", verdict: v >= 70 ? "In sync" : "Keep practising", note: "How closely your breathing followed the 6/min pacer." };
  }
  if (sc?.resonance != null) {
    return { value: sc.resonance, label: "Resonance", verdict: sc.resonance >= 50 ? "Strong" : "Building up", note: "Rise of the 0.1 Hz wave compared with rest." };
  }
  return null;
}

function ScoreRing({ value }: { value: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <svg viewBox="0 0 140 140" className="sum-ring" aria-hidden="true">
      <defs>
        <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <circle cx="70" cy="70" r={r} className="ring-track" />
      <circle
        cx="70"
        cy="70"
        r={r}
        className="ring-value"
        stroke="url(#ring-grad)"
        strokeDasharray={`${(v / 100) * c} ${c}`}
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="68" className="ring-number">{Math.round(v)}</text>
      <text x="70" y="90" className="ring-unit">/ 100</text>
    </svg>
  );
}

// ------------------------------------------------------------------ result tiles

type Tile = { label: string; value: string; unit: string; note?: string; tone: string };

function resultTiles(s: Summary): Tile[] {
  const out: Tile[] = [];
  const sc = s.scores;
  if (sc?.phase_lock != null) {
    out.push({ label: "Rhythm match", value: fmt(sc.phase_lock * 100), unit: "%", note: "breathing vs. 6/min pacer", tone: "#0b9a70" });
  }
  if (sc?.resonance != null) {
    out.push({ label: "Resonance 0.1 Hz", value: fmt(sc.resonance), unit: "/100", note: "upper half of the exercise", tone: "#8b5cf6" });
  }
  const exHr = s.exercise_stats?.hr_bpm;
  if (exHr != null) {
    const base = s.before?.hr_bpm;
    out.push({
      label: "Heart rate during",
      value: fmt(exHr),
      unit: " bpm",
      note: base != null ? `${signed(exHr - base, 1)} bpm vs. rest before` : undefined,
      tone: "#f43f5e",
    });
  }
  if (s.holds.length) {
    out.push({ label: "Longest hold", value: fmt(Math.max(...s.holds.map((h) => h.hold_s))), unit: " s", note: `${s.holds.length} hold${s.holds.length > 1 ? "s" : ""}`, tone: "#0ea5e9" });
    out.push({ label: "Peak HbO rise", value: fmt(Math.max(...s.holds.map((h) => h.hbo_rise_uM)), 2), unit: " µM", note: "oxygenated blood during holds", tone: "#dc2626" });
  }
  for (const m of s.movement) {
    out.push({ label: `Movement: ${m.target.replace("_", " ")}`, value: `${m.detected_reps}/${m.reps}`, unit: "", note: m.verified ? "passed" : "not passed", tone: "#64748b" });
  }
  if (s.recovery) {
    out.push({ label: "HR drop in 1 min", value: fmt(s.recovery.drop_1min_bpm), unit: " bpm", note: "simulated", tone: "#f43f5e" });
  }
  const q = s.quality;
  out.push({ label: "Measured", value: formatDuration(Math.round(q.measured_s)), unit: "", note: "min:s of signal", tone: "#0f766e" });
  if (q.measured_s) {
    out.push({ label: "Still time", value: fmt(100 * (1 - q.motion_s / q.measured_s)), unit: "%", note: `${q.motion_s} s with movement`, tone: "#64748b" });
  }
  return out;
}

// ------------------------------------------------------------------ before / after

type Row = { label: string; unit: string; before: number | null; after: number | null; digits: number; lowerIsBetter: boolean; delta: string | null; good: boolean | null };

function compareRows(s: Summary): Row[] {
  const b = s.before;
  const a = s.after;
  const d = s.delta;
  if (!b || !a) return [];
  return [
    { label: "Heart rate", unit: "bpm", before: b.hr_bpm, after: a.hr_bpm, digits: 0, lowerIsBetter: true,
      delta: d?.hr_bpm != null ? `${signed(d.hr_bpm, 1)} bpm` : null, good: d?.hr_bpm != null ? d.hr_bpm <= 0 : null },
    { label: "HRV (RMSSD)", unit: "ms", before: b.rmssd_ms, after: a.rmssd_ms, digits: 0, lowerIsBetter: false,
      delta: d?.rmssd_pct != null ? `${signed(d.rmssd_pct)}%` : null, good: d?.rmssd_pct != null ? d.rmssd_pct >= 0 : null },
    { label: "Breathing rate", unit: "/min", before: b.resp_rate_bpm, after: a.resp_rate_bpm, digits: 1, lowerIsBetter: true,
      delta: d?.resp_rate_bpm != null ? `${signed(d.resp_rate_bpm, 1)} /min` : null, good: d?.resp_rate_bpm != null ? d.resp_rate_bpm <= 0 : null },
  ];
}

/** Before → after on a small shared axis (dumbbell). */
function Dumbbell({ before, after, good }: { before: number | null; after: number | null; good: boolean | null }) {
  if (before == null || after == null) return <div className="dumbbell empty" />;
  const lo = Math.min(before, after);
  const hi = Math.max(before, after);
  const pad = Math.max((hi - lo) * 0.6, Math.abs(hi) * 0.05, 0.5);
  const pos = (v: number) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100;
  const [pb, pa] = [pos(before), pos(after)];
  return (
    <div className={cx("dumbbell", good === null ? "" : good ? "good" : "bad")}>
      <i className="track" />
      <i className="bar" style={{ left: `${Math.min(pb, pa)}%`, width: `${Math.abs(pa - pb)}%` }} />
      <b className="before" style={{ left: `${pb}%` }} />
      <b className="after" style={{ left: `${pa}%` }} />
    </div>
  );
}

// ------------------------------------------------------------------ screen

const INSIGHT_ICON: Record<Insight["kind"], string> = { positive: "✓", info: "i", tip: "→" };

export function SummaryScreen({ summary, onDone }: { summary: Summary; onDone: () => void }) {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [timelineFailed, setTimelineFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .timeline(summary.session_id)
      .then((t) => alive && setTimeline(t))
      .catch(() => alive && setTimelineFailed(true));
    return () => {
      alive = false;
    };
  }, [summary.session_id]);

  const score = mainScore(summary);
  const tiles = resultTiles(summary);
  const rows = compareRows(summary);
  const insights = buildInsights(summary);
  const real = summary.sources?.hr === "real";
  const when = new Date().toLocaleString("en-GB", { weekday: "long", hour: "2-digit", minute: "2-digit" });

  return (
    <AppShell tagline="BREATH • MOTION • FLOW" headerContent={<StatusPill english />}>
      <ScreenTitle
        eyebrow={`SESSION COMPLETE • ${formatDuration(Math.round(summary.duration_s))}`}
        title={EXERCISE_TITLES[summary.exercise] ?? summary.exercise}
        description={
          <>
            {when} • <span className={cx("source-badge", real ? "real" : "sim")}>{real ? "Recorded fNIRS data" : "Simulated signal"}</span>
          </>
        }
        aside={<Button onClick={onDone}>Back to hub</Button>}
      />

      <section className="sum-grid">
        <GlassPanel as="article" className="sum-score">
          {score ? (
            <>
              <span className="sum-caption">{score.label.toUpperCase()}</span>
              <ScoreRing value={score.value} />
              <strong className={cx("sum-verdict", score.value >= 55 ? "high" : score.value >= 40 ? "mid" : "low")}>
                {score.verdict}
              </strong>
              <p>{score.note}</p>
            </>
          ) : (
            <>
              <span className="sum-caption">SESSION</span>
              <strong className="sum-verdict">Well done</strong>
              <p>This exercise has no single score – see the results and the timeline.</p>
            </>
          )}
        </GlassPanel>

        <GlassPanel as="article" className="sum-results">
          <CardHeader caption="EXERCISE RESULTS" title="Key numbers" />
          <div className="sum-tiles">
            {tiles.map((t) => (
              <div key={t.label} className="sum-tile" style={{ ["--tone" as string]: t.tone }}>
                <small>{t.label}</small>
                <strong>
                  {t.value}
                  <em>{t.unit}</em>
                </strong>
                {t.note && <span>{t.note}</span>}
              </div>
            ))}
          </div>
        </GlassPanel>

        <GlassPanel as="article" className="sum-timeline">
          <CardHeader caption="SESSION TIMELINE" title="How your body responded" aside={<span className="sum-hint">Hover to inspect</span>} />
          {timeline ? (
            <SessionTimeline timeline={timeline} />
          ) : (
            <p className="empty-note">{timelineFailed ? "Timeline is not available for this session." : "Loading timeline…"}</p>
          )}
        </GlassPanel>

        <GlassPanel as="article" className="sum-compare">
          <CardHeader caption="REST BEFORE VS. AFTER" title="What changed" />
          {rows.length ? (
            <div className="compare-rows">
              <div className="compare-head">
                <span />
                <span>Before</span>
                <span />
                <span>After</span>
                <span>Change</span>
              </div>
              {rows.map((r) => (
                <div key={r.label} className="compare-row">
                  <span className="compare-label">
                    {r.label}
                    <small>{r.lowerIsBetter ? "lower = calmer" : "higher = calmer"}</small>
                  </span>
                  <span className="compare-val before">{fmt(r.before, r.digits)}<em> {r.unit}</em></span>
                  <Dumbbell before={r.before} after={r.after} good={r.good} />
                  <span className="compare-val after">{fmt(r.after, r.digits)}<em> {r.unit}</em></span>
                  <span className={cx("delta-chip", r.good === null ? "" : r.good ? "good" : "bad")}>{r.delta ?? "—"}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-note">Finish the whole session, including the rest after the exercise, to see a before/after comparison.</p>
          )}
        </GlassPanel>

        <GlassPanel as="article" className="sum-insights">
          <CardHeader caption="INSIGHTS" title="What it means" />
          <ul>
            {insights.map((ins, i) => (
              <li key={i} className={`ins ins-${ins.kind}`}>
                <i aria-hidden="true">{INSIGHT_ICON[ins.kind]}</i>
                <span>{ins.text}</span>
              </li>
            ))}
            {!insights.length && <li className="ins ins-info"><i>i</i><span>Not enough data for conclusions.</span></li>}
          </ul>
          <div className="sum-quality">
            <span>Signal quality <b>{fmt(summary.quality.good_pct)}%</b> good channels</span>
            <span>Movement <b>{summary.quality.motion_s} s</b></span>
            {summary.crf_mets != null && <span>Estimated fitness <b>{summary.crf_mets} MET</b></span>}
          </div>
        </GlassPanel>
      </section>
    </AppShell>
  );
}
