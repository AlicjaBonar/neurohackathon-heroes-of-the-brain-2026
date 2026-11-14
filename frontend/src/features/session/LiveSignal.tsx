import { useMemo } from "react";
import { CardHeader, GlassPanel } from "@/components/ui/Card";

const WIDTH = 550;
const HEIGHT = 150;
const MID_Y = 75;
const SAMPLES = 70;
const STEP_X = 8;
const CURSOR_X = 420;
const GRID_LINES = [30, 75, 120];

/** Height of the synthetic breathing wave at sample `index` for animation `tick`. */
function waveY(index: number, tick: number): number {
  const phase = tick * 0.24;
  return MID_Y + Math.sin(index * 0.38 + phase) * 22 + Math.sin(index * 0.11) * 9;
}

function LiveWave({ tick }: { tick: number }) {
  const path = useMemo(
    () =>
      Array.from(
        { length: SAMPLES },
        (_, index) => `${index ? "L" : "M"}${index * STEP_X} ${waveY(index, tick)}`,
      ).join(" "),
    [tick],
  );

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-label="Fala oddechowa i utlenowanie kory"
    >
      {GRID_LINES.map((y) => (
        <line key={y} x1="0" x2={WIDTH} y1={y} y2={y} />
      ))}
      <path d={path} className="breath-wave" />
      <path d={`${path} L${WIDTH + 2} ${HEIGHT} L0 ${HEIGHT}Z`} className="wave-fill" />
      <line x1={CURSOR_X} x2={CURSOR_X} y1="8" y2="140" className="cursor-line" />
      <circle cx={CURSOR_X} cy={waveY(CURSOR_X / STEP_X, tick)} r="5" className="cursor-dot" />
    </svg>
  );
}

export function LiveSignalCard({ tick, coherence }: { tick: number; coherence: number }) {
  return (
    <GlassPanel as="article" className="live-chart-card">
      <CardHeader
        caption="SYGNAŁ W CZASIE RZECZYWISTYM"
        title="Fala oddechowa i ΔHbO"
        aside={
          <div className="coherence">
            <small>KOHERENCJA</small>
            <strong>{coherence}%</strong>
          </div>
        }
      />
      <div className="live-wave">
        <LiveWave tick={tick} />
        <div className="wave-label">
          <span>WYDECH</span>
          <span>WDECH</span>
        </div>
      </div>
    </GlassPanel>
  );
}
