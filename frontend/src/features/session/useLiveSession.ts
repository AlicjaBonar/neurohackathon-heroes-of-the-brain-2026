import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/api/backend";
import { connectLiveStream, type LiveStream } from "@/api/liveSocket";
import type {
  ChannelsMsg,
  ClientMsg,
  EventMsg,
  FrameMsg,
  QualityMsg,
  ServerMsg,
  SessionCreated,
  SourceIn,
  Summary,
  VitalsMsg,
} from "@/api/types";

/** Number of samples kept for the live chart (10 Hz -> 30 s, three resonance breaths). */
export const BUFFER = 300;
/** Length of baseline_pre; the real 120 s default would make the demo drag. */
const BASELINE_S = 20;

/** One 10 Hz point of every live signal; `null` where the source has no value yet. */
export type SignalSample = {
  /** Breathing wave from fNIRS (z-scored). */
  breath: number;
  /** Pacer target height 0..1, only during a paced set. */
  target: number | null;
  hbo: number;
  hbr: number;
  /** HbO/HbR without the cardiac pulse (breathing, Mayer waves, slow drift). */
  hboTrend: number | null;
  hbrTrend: number | null;
  /** Same four values for the strongest single channel (null if the source has none). */
  best: { hbo: number; hbr: number; hboTrend: number | null; hbrTrend: number | null } | null;
  /** Instantaneous heart rate from the last inter-beat interval [bpm]. */
  hr: number | null;
  /** Movement level 0..1 (accelerometer). */
  motion: number;
  /** Latest phase-lock 0..1 (vitals, 1 Hz; held between updates). */
  lock: number | null;
  /** First sample of a new phase: a replay switches to another recording here, so lines break. */
  gap?: boolean;
};

/** One breath hold of the session; `rise` = HbO increase (µM), live while the hold lasts. */
export type HoldRecord = {
  kind: "short" | "max";
  startT: number;
  endT: number | null;
  /** Mean HbO (trend) at the onset and the highest value since. */
  hboStart: number | null;
  hboPeak: number | null;
  rise: number | null;
  /** Duration reported by the backend at the end of the hold. */
  holdS: number | null;
};

export type LiveState = {
  /** "checking" = connected, waiting for a good signal before the protocol starts. */
  status: "connecting" | "checking" | "running" | "finishing" | "done" | "error";
  error: string | null;
  sessionId: string | null;
  /** Latest per-channel HbO/HbR for the brain map (2 Hz). */
  channels: ChannelsMsg | null;
  device: SessionCreated["device"] | null;
  phase: string | null;
  phaseStartT: number;
  phaseDuration: number | null;
  frame: FrameMsg | null;
  vitals: VitalsMsg | null;
  quality: QualityMsg | null;
  samples: SignalSample[];
  events: EventMsg[];
  /** Breath holds so far (short and maximal). */
  holds: HoldRecord[];
  /** Number of paced breathing cycles so far (resonance breathing). */
  cycles: number;
  /** Highest heart rate in the current phase (HR recovery) and when it was reached. */
  hrPeak: { bpm: number; t: number } | null;
  /** Countdown between breathing sets: set at the end of a paced set, cleared when pacing resumes. */
  rest: { startT: number; duration: number } | null;
  /** Countdown to the first paced set; cleared when the pacer starts. */
  lead: { startT: number; duration: number } | null;
  /** A short breath hold in progress (from the hold_start event), with its target length. */
  hold: { startT: number; duration: number } | null;
  summary: Summary | null;
};

const INITIAL: LiveState = {
  status: "connecting",
  error: null,
  sessionId: null,
  channels: null,
  device: null,
  phase: null,
  phaseStartT: 0,
  phaseDuration: null,
  frame: null,
  vitals: null,
  quality: null,
  samples: [],
  events: [],
  holds: [],
  cycles: 0,
  hrPeak: null,
  rest: null,
  lead: null,
  hold: null,
  summary: null,
};

/** Paced breathing: sets of 5 breaths, then a 60 s rest (docs / backend exercises.plan). */
const SETS = 3;
const REST_S = 60;
/** Free breathing before the first set (backend exercises.plan). */
const LEAD_IN_S = 30;

/** The protocol starts once the signal has been "ready" this long (s). */
const READY_HOLD_S = 3;

/** Target breath height (0..1) for a pacer phase: 0 = start of inhale, 0.5 = peak. */
const targetHeight = (phase: number) => (1 - Math.cos(2 * Math.PI * phase)) / 2;

/**
 * One live session: creates it, opens the WebSocket, runs `baseline_pre` then the exercise
 * and finishes the session when the last phase ends (docs 8.4, 8.6).
 */
export function useLiveSession({
  userId,
  exercise,
  source,
}: {
  userId: string;
  exercise: string;
  source: SourceIn;
}) {
  const [state, setState] = useState<LiveState>(INITIAL);
  const streamRef = useRef<LiveStream<ClientMsg> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const startRef = useRef<() => void>(() => undefined);
  const startedRef = useRef(false);
  const samplesRef = useRef<SignalSample[]>([]);
  const finishingRef = useRef(false);
  const lockRef = useRef<number | null>(null);

  const finish = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || finishingRef.current) return;
    finishingRef.current = true;
    setState((s) => ({ ...s, status: "finishing" }));
    try {
      const summary = await api.finishSession(sid);
      streamRef.current?.close();
      setState((s) => ({ ...s, status: "done", summary }));
    } catch (error) {
      finishingRef.current = false;
      setState((s) => ({ ...s, status: "error", error: errorMessage(error) }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let protocol: string[] = [];
    let step = 0;
    let phaseName: string | null = null;
    let pacedNow = false;
    let setsDone = 0;
    let readySince: number | null = null;
    finishingRef.current = false;
    startedRef.current = false;
    startRef.current = () => {
      if (protocol.length && !phaseName && !startedRef.current) {
        startedRef.current = true;
        streamRef.current?.send({ type: "command", action: "start_phase", phase: protocol[0] });
      }
    };
    samplesRef.current = [];
    lockRef.current = null;
    setState(INITIAL);

    const handle = (msg: ServerMsg) => {
      switch (msg.type) {
        case "hello":
          // Signal check first; the protocol starts when the signal is ready (or the user says so).
          setState((s) => ({ ...s, status: s.status === "connecting" ? "checking" : s.status }));
          break;
        case "frame": {
          const target = msg.pacer ? targetHeight(msg.pacer.target_phase) : null;
          const sample: SignalSample = {
            breath: msg.breath.signal,
            target,
            hbo: msg.hb.hbo_uM,
            hbr: msg.hb.hbr_uM,
            hboTrend: msg.hb.hbo_trend_uM ?? null,
            hbrTrend: msg.hb.hbr_trend_uM ?? null,
            best: msg.hb.best
              ? {
                  hbo: msg.hb.best.hbo_uM,
                  hbr: msg.hb.best.hbr_uM,
                  hboTrend: msg.hb.best.hbo_trend_uM ?? null,
                  hbrTrend: msg.hb.best.hbr_trend_uM ?? null,
                }
              : null,
            hr: msg.hr_instant ?? null,
            motion: msg.motion.level,
            lock: lockRef.current,
          };
          samplesRef.current = [...samplesRef.current, sample].slice(-BUFFER);
          // A paced set has just ended -> start the rest countdown (not after the last set).
          let rest: LiveState["rest"] | undefined;
          if (phaseName === "resonance_breathing") {
            if (msg.pacer) {
              pacedNow = true;
              rest = null;
            } else if (pacedNow) {
              pacedNow = false;
              setsDone += 1;
              rest = setsDone < SETS ? { startT: msg.t, duration: REST_S } : null;
            }
          }
          const hboNow = msg.hb.hbo_trend_uM ?? msg.hb.hbo_uM;
          setState((s) => ({
            ...s,
            frame: msg,
            samples: samplesRef.current,
            // Track the HbO peak of the hold in progress.
            holds: s.holds.length && s.holds[s.holds.length - 1].endT === null
              ? s.holds.map((h, i) => {
                  if (i !== s.holds.length - 1) return h;
                  const peak = Math.max(h.hboPeak ?? hboNow, hboNow);
                  return { ...h, hboPeak: peak, rise: h.hboStart === null ? null : peak - h.hboStart };
                })
              : s.holds,
            lead: msg.pacer ? null : s.lead,
            ...(rest !== undefined && { rest }),
          }));
          break;
        }
        case "vitals":
          lockRef.current = msg.phase_lock?.value ?? null;
          setState((s) => {
            const bpm = msg.hr.bpm;
            const peak = bpm && !msg.hr.frozen && (!s.hrPeak || bpm > s.hrPeak.bpm) ? { bpm, t: msg.t } : s.hrPeak;
            return { ...s, vitals: msg, hrPeak: phaseName === "hr_recovery" ? peak : s.hrPeak };
          });
          break;
        case "channels":
          setState((s) => ({ ...s, channels: msg }));
          break;
        case "quality":
          // Auto-start after the signal has been ready for a few seconds.
          if (!phaseName && !startedRef.current) {
            readySince = msg.ready ? (readySince ?? msg.t) : null;
            if (readySince !== null && msg.t - readySince >= READY_HOLD_S) startRef.current();
          }
          setState((s) => ({ ...s, quality: msg }));
          break;
        case "event":
          setState((s) => {
            let holds = s.holds;
            if (msg.name === "hold_start") {
              const last = samplesRef.current[samplesRef.current.length - 1];
              const hbo = last ? (last.hboTrend ?? last.hbo) : null;
              const kind: HoldRecord["kind"] = msg.data?.kind === "max" ? "max" : "short";
              holds = [...holds, { kind, startT: msg.t, endT: null, hboStart: hbo, hboPeak: hbo, rise: 0, holdS: null }];
            } else if (msg.name === "hold_end_detected" && holds.length) {
              const d = msg.data ?? {};
              holds = holds.map((h, i) =>
                i === holds.length - 1
                  ? {
                      ...h,
                      endT: msg.t,
                      holdS: Number(d.hold_s ?? msg.t - h.startT),
                      // The backend's rise also covers the ~15 s after the hold, when HbO peaks.
                      rise: d.hbo_rise_uM !== undefined ? Number(d.hbo_rise_uM) : h.rise,
                    }
                  : h,
              );
            }
            return {
              ...s,
              events: [...s.events.slice(-19), msg],
              holds,
              cycles: msg.name === "cycle" ? Number(msg.data?.index ?? s.cycles + 1) : s.cycles,
              hold:
                msg.name === "hold_start" && msg.data?.kind === "short"
                  ? { startT: msg.t, duration: Number(msg.data.target_s ?? 10) }
                  : msg.name === "hold_end_detected"
                    ? null
                    : s.hold,
            };
          });
          break;
        case "phase":
          if (msg.state === "started") {
            // The server sends a tick's frame before its phase message, so the frame already received
            // is the first one of the new phase (a replay switches recordings there): break the line at it.
            const buf = samplesRef.current;
            if (buf.length) samplesRef.current = [...buf.slice(0, -1), { ...buf[buf.length - 1], gap: true }];
            phaseName = msg.phase;
            pacedNow = false;
            lockRef.current = null;
            setsDone = 0;
            setState((s) => ({
              ...s,
              rest: null,
              hold: null,
              hrPeak: null,
              lead:
                msg.phase === "resonance_breathing" ? { startT: msg.t, duration: LEAD_IN_S } : null,
              status: "running",
              phase: msg.phase,
              phaseStartT: msg.t,
              phaseDuration: msg.duration_s ?? null,
            }));
          } else if (step + 1 < protocol.length) {
            step += 1;
            streamRef.current?.send({ type: "command", action: "start_phase", phase: protocol[step] });
          } else {
            void finish();
          }
          break;
        case "error":
          // Non-fatal errors (e.g. a rejected command) don't stop the stream.
          if (msg.fatal) setState((s) => ({ ...s, status: "error", error: msg.message }));
          break;
        default:
          break;
      }
    };

    (async () => {
      try {
        // Rest before and after the exercise, so the summary can compare the two.
        protocol = ["baseline_pre", exercise, "baseline_post"];
        const open = (src: SourceIn) =>
          api.createSession({ user_id: userId, source: { ...src, baseline_s: BASELINE_S }, protocol });
        // Replay needs the recordings in data/ and the phase to exist for that person;
        // when it doesn't (404/422) fall back to the simulator.
        const created = await open(source).catch((error) => {
          const status = (error as { status?: number }).status;
          if (source.type === "replay" && (status === 404 || status === 422)) return open({ type: "mock" });
          throw error;
        });
        if (cancelled) return;
        sessionIdRef.current = created.session_id;
        setState((s) => ({ ...s, device: created.device, sessionId: created.session_id }));
        streamRef.current = connectLiveStream<ServerMsg, ClientMsg>(
          {
            onMessage: handle,
            onError: (error) => setState((s) => ({ ...s, status: "error", error: error.message })),
          },
          created.ws_url,
        );
      } catch (error) {
        if (!cancelled) setState((s) => ({ ...s, status: "error", error: errorMessage(error) }));
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.close();
      streamRef.current = null;
    };
    // The session is created once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const endHold = useCallback(() => {
    const sid = sessionIdRef.current;
    if (sid) void api.holdEnd(sid).catch(() => undefined);
  }, []);

  /** Skip the rest of the signal check and start the protocol now. */
  const start = useCallback(() => startRef.current(), []);

  return { state, finish, endHold, start };
}
