import { useEffect, useState } from "react";
import { api } from "@/api/backend";
import type { Dashboard, SeriesPoint, Summary } from "@/api/types";
import { AppShell } from "@/components/layout/AppShell";
import { BackButton } from "@/components/ui/Button";
import { GlassPanel, ValueWithUnit } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ScreenTitle } from "@/components/ui/Page";
import { formatTrend } from "@/lib/utils";
import { FlowTrendCard, SessionSummaryCard } from "./StatsCharts";
import { buildMetrics, trendOf7, type Metric } from "./statsData";

function MetricCard({ metric }: { metric: Metric }) {
  const { tone, icon, iconSize, label, value, unit, trend, side, simulated } = metric;
  return (
    <GlassPanel as="article" className={`metric-card ${tone}-card`}>
      <div className="metric-icon">
        <Icon name={icon} size={iconSize} />
      </div>
      <div className="metric-main">
        <span>
          {label}
          {simulated && <span className="sim-tag" title="Wartość symulowana">SYM</span>}
        </span>
        <ValueWithUnit value={value} unit={unit} />
        <p>
          <b>{formatTrend(trend.direction, trend.value)}</b> {trend.note}
        </p>
      </div>
      <div className="metric-side">
        <span>{side.label}</span>
        <strong>{side.value}</strong>
        <small>{side.unit}</small>
      </div>
    </GlassPanel>
  );
}

export function StatsScreen({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [resonance, setResonance] = useState<SeriesPoint[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api.dashboard(userId).then((d) => {
      setDashboard(d);
      const last = d.last_sessions[0];
      if (last) api.summary(last.id).then(setSummary).catch(() => setSummary(null));
    }).catch(() => setFailed(true));
    api.history(userId, ["resonance_score"], controller.signal)
      .then((h) => setResonance(h.metrics.resonance_score ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, [userId]);

  const trend = trendOf7(resonance);
  const lastDate = dashboard?.last_sessions[0]?.started_at;

  return (
    <AppShell>
      <div className="back-row">
        <BackButton onClick={onBack} />
        <span>OSTATNIE SESJE</span>
      </div>
      <ScreenTitle
        className="stats-title"
        eyebrow="TWOJE POSTĘPY"
        title="Statystyki i trendy"
        description="Zmiany względem Twojej własnej linii bazowej."
        aside={
          <div className="date-range">
            {lastDate ? new Date(lastDate).toLocaleDateString("pl-PL").toUpperCase() : "BRAK SESJI"}
          </div>
        }
      />
      {failed && <p className="form-error">Nie udało się pobrać danych z backendu.</p>}
      {dashboard && (
        <section className="stats-grid">
          <div className="metric-stack">
            {buildMetrics(dashboard).map((metric) => (
              <MetricCard key={metric.tone} metric={metric} />
            ))}
          </div>
          <div className="trends">
            <FlowTrendCard {...trend} />
            <SessionSummaryCard summary={summary} />
          </div>
        </section>
      )}
    </AppShell>
  );
}
