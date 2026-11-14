import { AppShell } from "@/components/layout/AppShell";
import { BackButton } from "@/components/ui/Button";
import { GlassPanel, ProgressBar, ValueWithUnit } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ScreenTitle } from "@/components/ui/Page";
import { formatTrend } from "@/lib/utils";
import { FlowTrendCard, SessionSummaryCard } from "./StatsCharts";
import { METRICS, type Metric } from "./statsData";

function MetricCard({ metric }: { metric: Metric }) {
  const { tone, icon, iconSize, label, value, unit, trend, side, meter } = metric;
  return (
    <GlassPanel as="article" className={`metric-card ${tone}-card`}>
      <div className="metric-icon">
        <Icon name={icon} size={iconSize} />
      </div>
      <div className="metric-main">
        <span>{label}</span>
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
      {meter && (
        <div className="economy">
          <span>{meter.label}</span>
          <ProgressBar value={meter.value} />
          <strong>{meter.value}%</strong>
        </div>
      )}
    </GlassPanel>
  );
}

export function StatsScreen({ onBack }: { onBack: () => void }) {
  return (
    <AppShell>
      <div className="back-row">
        <BackButton onClick={onBack} />
        <span>OSTATNIE 7 DNI</span>
      </div>
      <ScreenTitle
        className="stats-title"
        eyebrow="TWOJE POSTĘPY"
        title="Statystyki i trendy"
        description="Biometryczny obraz regeneracji i wydolności."
        aside={<div className="date-range">18–24 MAJA 2025</div>}
      />
      <section className="stats-grid">
        <div className="metric-stack">
          {METRICS.map((metric) => (
            <MetricCard key={metric.tone} metric={metric} />
          ))}
        </div>
        <div className="trends">
          <FlowTrendCard />
          <SessionSummaryCard />
        </div>
      </section>
    </AppShell>
  );
}
