import { useEffect, useState } from "react";
import { api } from "@/api/backend";
import type { Exercise, Probe, SourceIn, Summary } from "@/api/types";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { GlassPanel, ProgressBar } from "@/components/ui/Card";
import { Avatar } from "@/features/avatar/Avatar";
import type { AvatarConfig } from "@/features/avatar/avatarConfig";
import { BrainMapCard } from "@/features/brain/BrainMapCard";
import { cx, formatDuration } from "@/lib/utils";
import { HoldCounter, SignalCheck } from "./ExerciseWidgets";
import { describeEvent, EXERCISE_TITLES, SESSION_PHASE_LABELS, STAGE_LABELS, WARNING_TEXT } from "./labels";
import { LiveSignalCard } from "./LiveSignal";
import { useLiveSession, type LiveState } from "./useLiveSession";
import { VitalsPanel } from "./VitalsPanel";

const SHORT_HOLDS = 7;
/** Free breathing before each hold (backend exercises.plan / the DOT and supine BH tasks). */
const LEAD_BEFORE_HOLD_S = 30;
/** How long the result of a maximal hold stays on the avatar (s). */
const HOLD_RESULT_S = 8;

/** Red countdown over the avatar (rest between sets, short holds). */
function RestTimer({ seconds, label, hint }: { seconds: number; label: string; hint: string }) {
  return (
    <div className="rest-timer" role="timer" aria-label={`${label}, ${seconds} seconds left`}>
      <small>{label}</small>
      <strong>{seconds}</strong>
      <span>{hint}</span>
    </div>
  );
}

/** What the person should be doing right now, under the avatar. */
function phaseText(state: LiveState, now: number, leadLeft: number | null) {
  const { phase, phaseStartT, phaseDuration } = state;
  if (leadLeft !== null) return leadLeft > 0 ? `Set 1 in ${leadLeft} s – breathe freely` : "Set 1 is about to start…";
  if (!phase) return "Getting ready";
  if (phase === "baseline_pre" || phase === "baseline_post") {
    const left = phaseDuration ? Math.max(0, Math.ceil(phaseDuration - (now - phaseStartT))) : null;
    return `${SESSION_PHASE_LABELS[phase]}: sit still and breathe normally${left !== null ? ` – ${left} s` : ""}`;
  }
  if (phase === "short_holds" || phase === "breath_hold") {
    // Both plans: 30 s of breathing before each hold (backend exercises.plan).
    const last = state.holds[state.holds.length - 1];
    if (last && last.endT === null) {
      return phase === "breath_hold" ? "Hold your breath as long as is comfortable" : `Hold ${state.holds.length} of ${SHORT_HOLDS}`;
    }
    const doneShort = state.holds.filter((h) => h.kind === "short" && h.endT !== null).length;
    if (phase === "breath_hold" && last) return "Breathe normally and recover";
    if (phase === "short_holds" && doneShort >= SHORT_HOLDS) return "All holds done – breathe normally";
    const from = last?.endT ?? phaseStartT;
    const left = Math.max(0, Math.ceil(LEAD_BEFORE_HOLD_S - (now - from)));
    // Recordings may have a longer lead-in than the plan: never count below zero.
    const when = left > 0 ? `in ${left} s` : "coming up";
    return phase === "breath_hold"
      ? `Breathe normally – the maximal hold starts ${when}`
      : `Breathe deeply – hold ${state.holds.length + 1} of ${SHORT_HOLDS} ${when}`;
  }
  if (phase === "hr_recovery") return "Sit and breathe calmly – your heart rate is coming down";
  return SESSION_PHASE_LABELS[phase] ?? phase;
}

function BreathingPanel({
  state,
  avatar,
  bestHoldS,
}: {
  state: LiveState;
  avatar: AvatarConfig;
  bestHoldS: number | null;
}) {
  const { frame, phase, phaseStartT, phaseDuration, rest, lead, hold, holds } = state;
  const now = frame?.t ?? 0;
  const stage = frame ? (frame.pacer ?? frame.breath).stage : null;
  const elapsed = frame ? Math.max(0, now - phaseStartT) : 0;
  // The pacer drives the arms: up over the 4.5 s inhale, down over the 5.5 s exhale.
  const pace = frame?.pacer ? frame.pacer.target_phase : null;
  const restLeft = rest && frame ? Math.max(0, Math.ceil(rest.duration - (now - rest.startT))) : null;
  const leadLeft = lead && frame ? Math.max(0, Math.ceil(lead.duration - (now - lead.startT))) : null;
  const holdLeft = hold && frame ? Math.max(0, Math.ceil(hold.duration - (now - hold.startT))) : null;
  const shortHolding = holdLeft !== null && holdLeft > 0;
  const deepBreathing = phase === "short_holds" && !shortHolding;

  // Maximal hold: count up while holding, then show the result for a few seconds.
  const lastHold = holds[holds.length - 1];
  const maxHold = lastHold?.kind === "max" ? lastHold : null;
  const maxActive = !!maxHold && maxHold.endT === null;
  const maxResult = !!maxHold && maxHold.endT !== null && now - maxHold.endT < HOLD_RESULT_S;

  // The maximal hold has no fixed length, so its progress bar would be meaningless.
  const progress = phaseDuration && phase !== "breath_hold" ? Math.min(100, (elapsed / phaseDuration) * 100) : null;

  let overlay = null;
  if (shortHolding) {
    overlay = <RestTimer seconds={holdLeft} label="HOLD" hint={`hold ${holds.length} of ${SHORT_HOLDS} – hold your breath`} />;
  } else if (maxActive || maxResult) {
    const secs = maxHold!.endT === null ? now - maxHold!.startT : (maxHold!.holdS ?? maxHold!.endT - maxHold!.startT);
    overlay = <HoldCounter seconds={secs} best={bestHoldS} done={!maxActive} />;
  } else if (restLeft !== null) {
    overlay = <RestTimer seconds={restLeft} label="REST" hint="s until the next set" />;
  }

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
        pace={shortHolding || maxActive ? 0 : pace}
        deepBreathing={deepBreathing}
        overlay={overlay}
      />
      <div className="phase-info">
        <span>{phaseText(state, now, leadLeft)}</span>
        {progress !== null && <div className="phase-progress"><ProgressBar value={progress} /></div>}
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
  const { state, start } = useLiveSession({ userId, exercise: exercise.id, source });
  const [probe, setProbe] = useState<Probe | null>(null);
  const [bestHoldS, setBestHoldS] = useState<number | null>(null);

  // Hand the summary to the app as soon as the backend has produced it.
  useEffect(() => {
    if (state.status === "done" && state.summary) onSummary(state.summary);
  }, [state.status, state.summary, onSummary]);

  // Probe geometry for the signal check; personal best for the maximal hold.
  useEffect(() => {
    if (state.sessionId) api.probe(state.sessionId).then(setProbe).catch(() => undefined);
  }, [state.sessionId]);
  useEffect(() => {
    if (exercise.id !== "breath_hold") return;
    api.dashboard(userId).then((d) => setBestHoldS(d.records.hold_s?.value ?? null)).catch(() => undefined);
  }, [exercise.id, userId]);

  const { frame, vitals, device, status } = state;

  const lastEvent = [...state.events].reverse().find((e) => describeEvent(e));
  // Contact warnings (saturation, weak signal) belong to the signal check; during the exercise
  // only movement is something the person can fix.
  const firstWarning = state.quality?.warnings.find((w) => w.code === "motion");
  const warning = firstWarning ? (WARNING_TEXT[firstWarning.code] ?? firstWarning.text) : undefined;
  const checking = status === "connecting" || status === "checking";

  if (status === "error") {
    return (
      <AppShell variant="session" onBack={onExit}>
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
      onBack={onExit}
      headerContent={
        <div className="live-title">
          <i /> {EXERCISE_TITLES[exercise.id] ?? exercise.title}{" "}
          {device && <b>{device.source === "simulated" ? "SIMULATION" : "RECORDING"}</b>}
        </div>
      }
    >
      <section className="session-grid">
        {checking ? (
          <GlassPanel className="breathing-panel active">
            <SignalCheck probe={probe} quality={state.quality} onStart={start} />
          </GlassPanel>
        ) : (
          <BreathingPanel
            state={state}
            avatar={avatar}
            bestHoldS={bestHoldS}
          />
        )}
        <div className="live-column">
          <LiveSignalCard
            samples={state.samples}
            exercise={exercise.id}
            stage={frame ? STAGE_LABELS[frame.breath.stage] : ""}
            hb={frame?.hb}
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
          {!checking && (lastEvent || warning) && (
            <GlassPanel className="event-banner">
              {lastEvent && <strong>{describeEvent(lastEvent)}</strong>}
              {warning && <span>{warning}</span>}
            </GlassPanel>
          )}
          <VitalsPanel
            vitals={vitals}
            ctx={{
              exercise: exercise.id,
              phase: state.phase,
              now: frame?.t ?? 0,
              phaseStartT: state.phaseStartT,
              holds: state.holds,
              bestHoldS,
              hrPeak: state.hrPeak,
            }}
          />
        </div>
        <BrainMapCard
          sessionId={state.sessionId}
          channels={state.channels}
          qualityChannels={state.quality?.channels}
        />
      </section>
    </AppShell>
  );
}
