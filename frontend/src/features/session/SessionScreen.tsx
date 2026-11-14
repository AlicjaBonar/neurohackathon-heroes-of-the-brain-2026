import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { BackButton, Button } from "@/components/ui/Button";
import { GlassPanel, ProgressBar } from "@/components/ui/Card";
import type { Exercise, SourceIn, Summary } from "@/api/types";
import { Avatar } from "@/features/avatar/Avatar";
import type { AvatarConfig } from "@/features/avatar/avatarConfig";
import { cx, formatDuration } from "@/lib/utils";
import { describeEvent, PHASE_LABELS, STAGE_LABELS } from "./labels";
import { LiveSignalCard } from "./LiveSignal";
import { useLiveSession, type LiveState } from "./useLiveSession";
import { VitalsPanel } from "./VitalsPanel";

/** Red countdown that covers the avatar during the rest between breathing sets. */
function RestTimer({ seconds, label, hint }: { seconds: number; label: string; hint: string }) {
  return (
    <div className="rest-timer" role="timer" aria-label={`${label}, jeszcze ${seconds} sekund`}>
      <small>{label}</small>
      <strong>{seconds}</strong>
      <span>{hint}</span>
    </div>
  );
}

function BreathingPanel({
  state,
  avatar,
  canEndHold,
  onEndHold,
  onEnd,
}: {
  state: LiveState;
  avatar: AvatarConfig;
  canEndHold: boolean;
  onEndHold: () => void;
  onEnd: () => void;
}) {
  const { frame, phase, phaseStartT, phaseDuration, rest, lead, hold } = state;
  const stage = frame ? (frame.pacer ?? frame.breath).stage : null;
  const elapsed = frame ? Math.max(0, frame.t - phaseStartT) : 0;
  // The pacer drives the arms: up over the 4.5 s inhale, down over the 5.5 s exhale.
  const pace = frame?.pacer ? frame.pacer.target_phase : null;
  const restLeft = rest && frame ? Math.max(0, Math.ceil(rest.duration - (frame.t - rest.startT))) : null;
  const leadLeft = lead && frame ? Math.max(0, Math.ceil(lead.duration - (frame.t - lead.startT))) : null;
  // Short holds: deep breaths between holds, then a red "BEZDECH" countdown over the avatar.
  const holdLeft = hold && frame ? Math.max(0, Math.ceil(hold.duration - (frame.t - hold.startT))) : null;
  const holding = holdLeft !== null && holdLeft > 0;
  const deepBreathing = phase === "short_holds" && !holding;
  const progress = phaseDuration ? Math.min(100, (elapsed / phaseDuration) * 100) : null;
  return (
    <GlassPanel className={cx("breathing-panel", "active")}>
      <div className="breath-header">
        <span>{stage ? STAGE_LABELS[stage] : "ŁĄCZENIE…"}</span>
        <strong>{formatDuration(Math.floor(elapsed))}</strong>
      </div>
      <Avatar
        breathing={!pace && stage !== null && stage !== "hold"}
        aura
        avatar={avatar}
        pace={holding ? 0 : pace}
        deepBreathing={deepBreathing}
        overlay={
          holding ? (
            <RestTimer seconds={holdLeft} label="BEZDECH" hint="wstrzymaj oddech" />
          ) : (
            restLeft !== null && (
              <RestTimer seconds={restLeft} label="PRZERWA" hint="s do kolejnej serii" />
            )
          )
        }
      />
      <div className="phase-info">
        <span>
          {leadLeft !== null
            ? leadLeft > 0
              ? `Seria 1 za ${leadLeft} s – oddychaj swobodnie`
              : "Seria 1 zaraz się zacznie…"
            : phase
              ? (PHASE_LABELS[phase] ?? phase)
              : "Przygotowanie"}
        </span>
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
  avatar,
  onSummary,
  onExit,
}: {
  userId: string;
  exercise: Exercise;
  source: SourceIn;
  avatar: AvatarConfig;
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
          avatar={avatar}
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
            footer={
              <>
                <span className={cx("status-dot", state.quality?.ready ? "ok" : "wait")} />
                Jakość sygnału: {state.quality ? `${Math.round(state.quality.good_pct)}% dobrych kanałów` : "…"}
                <span>•</span>
                {frame ? (frame.motion.still ? "bezruch – pomiar ważny" : "ruch – pomiar wstrzymany") : "…"}
                <span>•</span>
                {device ? `${device.n_pairs} par źródło–detektor` : ""}
              </>
            }
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
          <VitalsPanel vitals={vitals} paced={state.phase === "resonance_breathing"} />
        </div>
      </section>
    </AppShell>
  );
}
