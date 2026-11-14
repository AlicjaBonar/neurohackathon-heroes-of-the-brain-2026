import { useEffect, useState } from "react";

const TICK_MS = 900;
const TICKS_PER_BREATH_PHASE = 4;

export type BreathPhase = "Wdech" | "Wydech";

/**
 * Drives the live session: an animation `tick`, elapsed `seconds` and the current
 * breath phase. Pausing (`active = false`) freezes everything.
 */
export function useSessionClock({
  active,
  initialSeconds = 0,
}: {
  active: boolean;
  initialSeconds?: number;
}) {
  const [tick, setTick] = useState(0);
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
      setSeconds((value) => value + 1);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  const phase: BreathPhase =
    tick % (TICKS_PER_BREATH_PHASE * 2) < TICKS_PER_BREATH_PHASE ? "Wdech" : "Wydech";

  return { tick, seconds, phase };
}
