import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "@/api/backend";
import type { Dashboard, Fitness, History, Summary } from "@/api/types";
import { AppShell } from "@/components/layout/AppShell";
import { GlassPanel } from "@/components/ui/Card";
import { ScreenTitle } from "@/components/ui/Page";
import { cx } from "@/lib/utils";
import { FitnessCard, HourCard, SessionSummaryCard, Sparkline, TrendCard } from "./StatsCharts";
import { buildStats, fmt, HISTORY_KEYS, ratingOf, type MetricStat } from "./statsData";

/** Same tile as the live panel in the session view, filled with the history of one metric. */
function StatTile({ stat }: { stat: MetricStat }) {
  const { def, latest, delta, improved, points } = stat;
  const simulated = latest.source === "simulated";
  return (
    <GlassPanel as="article" className="vital-tile stat-tile" style={{ "--tone": def.color } as CSSProperties}>
      <small>
        {def.label}
        {simulated && <span className="sim-tag" title="Simulated value">SYM</span>}
      </small>
      <strong>
        {fmt(latest.value, def.digits)}
        <em>{def.unit}</em>
      </strong>
      {delta !== null && (
        <span className={cx("vital-delta", improved === null ? "neutral" : improved ? "good" : "bad")}>
          {delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(def.digits)}
          {" "}vs average
        </span>
      )}
      <Sparkline values={points.slice(-10).map((p) => p.value)} color={def.color} />
    </GlassPanel>
  );
}

export function StatsScreen({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [fitness, setFitness] = useState<Fitness | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    api
      .dashboard(userId)
      .then((d) => {
        setDashboard(d);
        const last = d.last_sessions[0];
        if (last) api.summary(last.id).then(setSummary).catch(() => setSummary(null));
      })
      .catch(() => !signal.aborted && setFailed(true));
    api.history(userId, HISTORY_KEYS, signal, true).then(setHistory).catch(() => undefined);
    api.fitness(userId, signal).then(setFitness).catch(() => undefined);
    return () => controller.abort();
  }, [userId]);

  const stats = useMemo(() => (history ? buildStats(history.metrics) : []), [history]);
  const hours = history?.by_hour?.hr_bpm ?? [];
  const sessions = dashboard?.last_sessions ?? [];
  const lastDate = sessions[0]?.started_at;
  const loading = !failed && (!dashboard || !history);

  return (
    <AppShell onBack={onBack}>
      <ScreenTitle
        className="stats-title"
        eyebrow="YOUR PROGRESS"
        title="Vitals"
        description="Metrics from your live sessions, over time and against your own average."
        aside={
          <div className="date-range">
            {lastDate ? `LAST SESSION ${new Date(lastDate).toLocaleDateString("en-GB")}` : "NO SESSIONS"}
          </div>
        }
      />
      {failed && <p className="form-error">Could not load data from the backend.</p>}
      {loading && <p className="empty-note">Loading…</p>}
      {dashboard?.readiness.text && (
        <GlassPanel className="stat-readiness">
          <i /> {dashboard.readiness.text}
        </GlassPanel>
      )}
      {history && !stats.length && (
        <p className="empty-note">No finished sessions yet. Complete your first session and your vitals will appear here.</p>
      )}
      {stats.length > 0 && (
        <section className="stats-page">
          <div className="stat-tiles">
            {stats.map((s) => (
              <StatTile key={s.def.key} stat={s} />
            ))}
          </div>
          <div className="stat-columns">
            <TrendCard stats={stats} />
            <div className="stat-side">
              {fitness && <FitnessCard fitness={fitness} />}
              <SessionSummaryCard summary={summary} ratingText={ratingOf(summary?.scores?.relaxation)} />
            </div>
          </div>
          <HourCard hours={hours} />
        </section>
      )}
    </AppShell>
  );
}
