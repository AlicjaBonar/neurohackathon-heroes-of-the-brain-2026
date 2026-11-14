import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { BackButton, Button } from "@/components/ui/Button";
import { GlassPanel, ValueWithUnit } from "@/components/ui/Card";
import { Avatar, type HairColor } from "@/features/avatar/Avatar";
import { cx, formatDuration, formatTrend, SENSOR_RATE_LABEL } from "@/lib/utils";
import { LiveSignalCard } from "./LiveSignal";
import { LIVE_METRICS, type LiveMetric, type SessionMode } from "./sessionData";
import { useSessionClock, type BreathPhase } from "./useSessionClock";

function BreathingPanel({
  active,
  phase,
  seconds,
  hair,
  onToggle,
  onEnd,
}: {
  active: boolean;
  phase: BreathPhase;
  seconds: number;
  hair: HairColor;
  onToggle: () => void;
  onEnd: () => void;
}) {
  return (
    <GlassPanel className={cx("breathing-panel", active ? "active" : "paused")}>
      <div className="breath-header">
        <span>{active ? phase.toUpperCase() : "PAUZA"}</span>
        <strong>{formatDuration(seconds)}</strong>
      </div>
      <Avatar breathing={active} aura hair={hair} />
      <div className="avatar-session-controls">
        <button type="button" className="pause-button" onClick={onToggle}>
          <span>{active ? "Ⅱ" : "▶"}</span>
          <small>{active ? "Wstrzymaj" : "Wznów"}</small>
        </button>
        <Button variant="danger" onClick={onEnd}>
          Zakończ
        </Button>
      </div>
    </GlassPanel>
  );
}

function LiveMetricCard({ metric }: { metric: LiveMetric }) {
  return (
    <GlassPanel as="article" className={metric.tone}>
      <div>
        <small>{metric.label}</small>
        <ValueWithUnit
          value={formatTrend(metric.direction, metric.value)}
          unit={metric.unit}
          unitAs="em"
        />
        <p>{metric.note}</p>
      </div>
    </GlassPanel>
  );
}

export function SessionScreen({
  mode,
  hair,
  onEnd,
}: {
  mode: SessionMode;
  hair: HairColor;
  onEnd: () => void;
}) {
  const [active, setActive] = useState(true);
  const { tick, seconds, phase } = useSessionClock({ active, initialSeconds: 164 });

  return (
    <AppShell
      variant="session"
      headerContent={
        <>
          <div className="live-title">
            <i /> {mode.title} <span>•</span> fNIRS {SENSOR_RATE_LABEL} <b>NA ŻYWO</b>
          </div>
          <BackButton onClick={onEnd} />
        </>
      }
    >
      <section className="session-grid">
        <BreathingPanel
          active={active}
          phase={phase}
          seconds={seconds}
          hair={hair}
          onToggle={() => setActive((value) => !value)}
          onEnd={onEnd}
        />
        <div className="live-column">
          <LiveSignalCard tick={tick} coherence={91} />
          <div className="live-metrics">
            {LIVE_METRICS.map((metric) => (
              <LiveMetricCard key={metric.tone} metric={metric} />
            ))}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
