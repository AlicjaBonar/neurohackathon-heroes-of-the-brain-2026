import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { BackButton, Button } from "@/components/ui/Button";
import { GlassPanel, ProgressBar, ValueWithUnit } from "@/components/ui/Card";
import type { Exercise, SourceIn, Summary } from "@/api/types";
import { Avatar, type HairColor } from "@/features/avatar/Avatar";
import { cx, formatDuration, formatTrend, type TrendDirection } from "@/lib/utils";
import { describeEvent, isLowConfidence, PHASE_LABELS, STAGE_LABELS } from "./labels";
import { LiveSignalCard } from "./LiveSignal";
import { useLiveSession, type LiveState } from "./useLiveSession";

type Metric = {
  tone: "hrv" | "hr" | "aux";
  label: string;
  value: string;
  unit: string;
  delta?: { direction: TrendDirection; text: string };
  note: string;
  simulated: boolean;
  dim: boolean;
};

function buildMetrics({ vitals, frame }: LiveState): Metric[] {
  const hr = vitals?.hr;
  const hrv = vitals?.hrv;
  const vs = vitals?.vs_baseline;
  const rmssdDelta = vs?.rmssd_delta_pct;
  const hrDelta = vs?.hr_delta_bpm;
  return [
    {
      tone: "hrv",
      label: "HRV • RMSSD",
      value: hrv?.rmssd_ms ? hrv.rmssd_ms.toFixed(0) : "—",
      unit: " ms",
      delta:
        rmssdDelta === undefined
          ? undefined
          : { direction: rmssdDelta >= 0 ? "up" : "down", text: `${rmssdDelta > 0 ? "+" : ""}${rmssdDelta}%` },
      note: hrv?.rmssd_ms ? "vs. pomiar spoczynkowy" : "pojawi się po ok. 30 s",
      simulated: hrv?.source === "simulated",
      dim: isLowConfidence(hrv?.confidence),
    },
    {
      tone: "hr",
      label: "TĘTNO",
      value: hr?.bpm ? hr.bpm.toFixed(0) : "—",
      unit: " BPM",
      delta:
        hrDelta === undefined
          ? undefined
          : { direction: hrDelta >= 0 ? "up" : "down", text: `${hrDelta > 0 ? "+" : ""}${hrDelta}` },
      note: hr?.frozen ? "wstrzymane – ruch" : "vs. pomiar spoczynkowy",
      simulated: hr?.source === "simulated",
      dim: isLowConfidence(hr?.confidence) || !!hr?.frozen,
    },
    {
      tone: "aux",
      label: "RUCH AUX",
      value: frame ? Math.round(frame.motion.level * 100).toString() : "—",
      unit: "%",
      note: frame ? (frame.motion.still ? "bezruch – pomiar ważny" : "ruch – pomiar wstrzymany") : "",
      simulated: frame?.motion.source === "simulated",
      dim: false,
    },
  ];
}

function LiveMetricCard({ metric }: { metric: Metric }) {
  return (
    <GlassPanel as="article" className={cx(metric.tone, metric.dim && "low-confidence")}>
      <div>
        <small>
          {metric.label}
          {metric.simulated && <span className="sim-tag" title="Wartość symulowana">SYM</span>}
        </small>
        <ValueWithUnit
          value={metric.delta ? `${formatTrend(metric.delta.direction, metric.delta.text)} · ${metric.value}` : metric.value}
          unit={metric.unit}
          unitAs="em"
        />
        <p>{metric.note}</p>
      </div>
    </GlassPanel>
  );
}

function BreathingPanel({
  state,
  hair,
  canEndHold,
  onEndHold,
  onEnd,
}: {
  state: LiveState;
  hair: HairColor;
  canEndHold: boolean;
  onEndHold: () => void;
  onEnd: () => void;
}) {
  const { frame, phase, phaseStartT, phaseDuration } = state;
  const stage = frame ? (frame.pacer ?? frame.breath).stage : null;
  const elapsed = frame ? Math.max(0, frame.t - phaseStartT) : 0;
  const progress = phaseDuration ? Math.min(100, (elapsed / phaseDuration) * 100) : null;
  return (
    <GlassPanel className={cx("breathing-panel", "active")}>
      <div className="breath-header">
        <span>{stage ? STAGE_LABELS[stage] : "ŁĄCZENIE…"}</span>
        <strong>{formatDuration(Math.floor(elapsed))}</strong>
      </div>
      <Avatar breathing={stage !== null && stage !== "hold"} aura hair={hair} />
      <div className="phase-info">
        <span>{phase ? (PHASE_LABELS[phase] ?? phase) : "Przygotowanie"}</span>
        {progress !== null && <div className="phase-progress"><ProgressBar value={progress} /></div>}
      </div>
      <div className="avatar-session-controls">
        {canEndHold && (
          <Button onClick={onEndHold}>Skończyłem</Button>
        )}
        <Button variant="danger" onClick={onEnd}>
          Zakończ
        </Button>
      </div>
    </GlassPanel>
  );
}

export function SessionScreen({
  userId,
  exercise,
  source,
  hair,
  onSummary,
  onExit,
}: {
  userId: string;
  exercise: Exercise;
  source: SourceIn;
  hair: HairColor;
  onSummary: (summary: Summary) => void;
  onExit: () => void;
}) {
  const { state, finish, endHold, simulateMotion } = useLiveSession({ userId, exercise: exercise.id, source });

  // Hand the summary to the app as soon as the backend has produced it.
  useEffect(() => {
    if (state.status === "done" && state.summary) onSummary(state.summary);
  }, [state.status, state.summary, onSummary]);

  const { frame, vitals, device, status } = state;
  const lastEvent = [...state.events].reverse().find((e) => describeEvent(e));
  const warning = state.quality?.warnings[0]?.text;
  const isPaced = !!frame?.pacer;
  const score = isPaced && vitals?.phase_lock
    ? Math.round(vitals.phase_lock.value * 100)
    : vitals ? Math.round(vitals.resonance.score) : null;
  const canEndHold = state.phase === "breath_hold" && frame?.breath.stage === "hold";

  if (status === "error") {
    return (
      <AppShell variant="session" headerContent={<BackButton onClick={onExit} />}>
        <GlassPanel className="session-error">
          <h2>Nie udało się uruchomić sesji</h2>
          <p>{state.error}</p>
          <Button onClick={onExit}>Wróć</Button>
        </GlassPanel>
      </AppShell>
    );
  }

  return (
    <AppShell
      variant="session"
      headerContent={
        <>
          <div className="live-title">
            <i /> {exercise.title} <span>•</span> fNIRS {device ? `${device.fs_hz} Hz` : "…"}{" "}
            <b>{device?.source === "simulated" ? "SYMULACJA" : "NA ŻYWO"}</b>
          </div>
          <BackButton onClick={onExit} />
        </>
      }
    >
      <section className="session-grid">
        <BreathingPanel
          state={state}
          hair={hair}
          canEndHold={canEndHold}
          onEndHold={endHold}
          onEnd={() => void finish()}
        />
        <div className="live-column">
          <LiveSignalCard
            samples={state.samples}
            scoreLabel={isPaced ? "ZGODNOŚĆ Z RYTMEM" : "REZONANS"}
            score={score}
            stage={frame ? STAGE_LABELS[frame.breath.stage] : ""}
          />
          {(lastEvent || warning || state.pendingCommand) && (
            <GlassPanel className="event-banner">
              {lastEvent && <strong>{describeEvent(lastEvent)}</strong>}
              {warning && <span>{warning}</span>}
              {state.pendingCommand && (
                <div className="event-actions">
                  <Button onClick={() => simulateMotion(true, state.pendingCommand!)}>Symuluj poprawny ruch</Button>
                  <Button variant="ghost" onClick={() => simulateMotion(false, state.pendingCommand!)}>
                    Symuluj błędny ruch
                  </Button>
                </div>
              )}
            </GlassPanel>
          )}
          <div className="live-metrics">
            {buildMetrics(state).map((metric) => (
              <LiveMetricCard key={metric.tone} metric={metric} />
            ))}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
