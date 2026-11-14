import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { BackButton, Button } from "@/components/ui/Button";
import { GlassPanel, ProgressBar } from "@/components/ui/Card";
import type { Exercise, SourceIn, Summary } from "@/api/types";
import { Avatar } from "@/features/avatar/Avatar";
import { BrainMapCard } from "@/features/brain/BrainMapCard";
import type { AvatarConfig } from "@/features/avatar/avatarConfig";
import { cx, formatDuration } from "@/lib/utils";
import { describeEvent, EXERCISE_TITLES, SESSION_PHASE_LABELS, STAGE_LABELS, WARNING_TEXT } from "./labels";
import { LiveSignalCard } from "./LiveSignal";
import { useLiveSession, type LiveState } from "./useLiveSession";
import { VitalsPanel } from "./VitalsPanel";

/** Red countdown that covers the avatar during the rest between breathing sets. */
function RestTimer({ seconds, label, hint }: { seconds: number; label: string; hint: string }) {
  return (
    <div className="rest-timer" role="timer" aria-label={`${label}, ${seconds} seconds left`}>
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
        <span>{stage ? STAGE_LABELS[stage] : "CONNECTING…"}</span>
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
            <RestTimer seconds={holdLeft} label="HOLD" hint="hold your breath" />
          ) : (
            restLeft !== null && (
              <RestTimer seconds={restLeft} label="REST" hint="s until the next set" />
            )
          )
        }
      />
      <div className="phase-info">
        <span>
          {leadLeft !== null
            ? leadLeft > 0
              ? `Set 1 in ${leadLeft} s – breathe freely`
              : "Set 1 is about to start…"
            : phase
              ? (SESSION_PHASE_LABELS[phase] ?? phase)
              : "Getting ready"}
        </span>
        {progress !== null && <div className="phase-progress"><ProgressBar value={progress} /></div>}
      </div>
      <div className="avatar-session-controls">
        {canEndHold && (
          <Button onClick={onEndHold}>I'm done</Button>
        )}
        <Button variant="danger" onClick={onEnd}>
          End session
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
  const firstWarning = state.quality?.warnings[0];
  const warning = firstWarning ? (WARNING_TEXT[firstWarning.code] ?? firstWarning.text) : undefined;
  const isPaced = !!frame?.pacer;
  const score = isPaced && vitals?.phase_lock
    ? Math.round(vitals.phase_lock.value * 100)
    : vitals ? Math.round(vitals.resonance.score) : null;
  const canEndHold = state.phase === "breath_hold" && frame?.breath.stage === "hold";

  if (status === "error") {
    return (
      <AppShell variant="session" tagline="BREATH • MOTION • FLOW" headerContent={<BackButton onClick={onExit} label="Back" />}>
        <GlassPanel className="session-error">
          <h2>Could not start the session</h2>
          <p>{state.error}</p>
          <Button onClick={onExit}>Back</Button>
        </GlassPanel>
      </AppShell>
    );
  }

  return (
    <AppShell
      variant="session"
      tagline="BREATH • MOTION • FLOW"
      headerContent={
        <>
          <div className="live-title">
            <i /> {EXERCISE_TITLES[exercise.id] ?? exercise.title} <span>•</span> fNIRS {device ? `${device.fs_hz} Hz` : "…"}{" "}
            <b>{device?.source === "simulated" ? "SIMULATION" : "LIVE"}</b>
          </div>
          <BackButton onClick={onExit} label="Back" />
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
            scoreLabel={isPaced ? "RHYTHM MATCH" : "RESONANCE"}
            score={score}
            stage={frame ? STAGE_LABELS[frame.breath.stage] : ""}
            footer={
              <>
                <span className={cx("status-dot", state.quality?.ready ? "ok" : "wait")} />
                Signal quality: {state.quality ? `${Math.round(state.quality.good_pct)}% good channels` : "…"}
                <span>•</span>
                {frame ? (frame.motion.still ? "still – measurement valid" : "moving – measurement paused") : "…"}
                <span>•</span>
                {device ? `${device.n_pairs} source–detector pairs` : ""}
              </>
            }
          />
          {(lastEvent || warning || state.pendingCommand) && (
            <GlassPanel className="event-banner">
              {lastEvent && <strong>{describeEvent(lastEvent)}</strong>}
              {warning && <span>{warning}</span>}
              {state.pendingCommand && (
                <div className="event-actions">
                  <Button onClick={() => simulateMotion(true, state.pendingCommand!)}>Simulate correct move</Button>
                  <Button variant="ghost" onClick={() => simulateMotion(false, state.pendingCommand!)}>
                    Simulate wrong move
                  </Button>
                </div>
              )}
            </GlassPanel>
          )}
          <VitalsPanel vitals={vitals} paced={state.phase === "resonance_breathing"} />
        </div>
        <BrainMapCard
          sessionId={state.sessionId}
          channels={state.channels}
          qualityChannels={state.quality?.channels}
          breath={frame?.breath.signal ?? null}
        />
      </section>
    </AppShell>
  );
}
