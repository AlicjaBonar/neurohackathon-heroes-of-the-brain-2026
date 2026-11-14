import { useId } from "react";
import { CardHeader, GlassPanel, ProgressBar } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { formatTrend } from "@/lib/utils";
import { FLOW_TREND, LAST_SESSION } from "./statsData";

const X_START = 35;
const X_STEP = 72;
const BASELINE = 190;
const Y_SCALE = 1.55;
const GRID_LINES = [40, 80, 120, 160];
const Y_LABELS = [100, 75, 50, 25];

const toX = (index: number) => X_START + index * X_STEP;
const toY = (value: number) => BASELINE - value * Y_SCALE;

/** Area + line chart of 0–100 scores, one point per day. */
function TrendChart({ values, labels }: { values: number[]; labels: string[] }) {
  const gradientId = useId();
  const points = values.map((value, index) => `${toX(index)},${toY(value)}`).join(" ");
  const lastIndex = values.length - 1;
  const area = `${X_START},196 ${points} ${toX(lastIndex)},196`;

  return (
    <div className="trend-chart">
      <div className="chart-y">
        {Y_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <svg viewBox="0 0 500 215" preserveAspectRatio="none" aria-label="Wykres trendu">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#00b4d8" stopOpacity=".42" />
            <stop offset="1" stopColor="#00b4d8" stopOpacity=".02" />
          </linearGradient>
        </defs>
        {GRID_LINES.map((y) => (
          <line x1="30" x2="475" y1={y} y2={y} key={y} />
        ))}
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline points={points} className="trend-line" />
        {values.map((value, index) => (
          <circle key={index} cx={toX(index)} cy={toY(value)} r={index === lastIndex ? 6 : 3.5} />
        ))}
      </svg>
      <div className="chart-days">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  );
}

export function FlowTrendCard() {
  return (
    <GlassPanel as="article" className="chart-card">
      <CardHeader
        caption="7-DNIOWY TREND"
        title="Gotowość do Flow"
        aside={
          <div className="chart-score">
            <strong>{FLOW_TREND.current}%</strong>
            <span>{formatTrend(FLOW_TREND.change.direction, FLOW_TREND.change.value)}</span>
          </div>
        }
      />
      <TrendChart values={FLOW_TREND.values} labels={FLOW_TREND.days} />
    </GlassPanel>
  );
}

export function SessionSummaryCard() {
  return (
    <GlassPanel as="article" className="summary-card">
      <CardHeader
        caption={`OSTATNIA SESJA • ${LAST_SESSION.duration}`}
        title="Podsumowanie sesji"
        aside={
          <span className="good-badge">
            <Icon name="check" size={14} /> {LAST_SESSION.rating}
          </span>
        }
      />
      <div className="summary-bars">
        {LAST_SESSION.bars.map((bar) => (
          <div key={bar.label}>
            <span>
              {bar.label} {bar.hint && <small>{bar.hint}</small>}
            </span>
            <ProgressBar value={bar.value} />
            <strong>{bar.value}%</strong>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
