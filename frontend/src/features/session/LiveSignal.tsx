import { CardHeader, GlassPanel } from "@/components/ui/Card";
import type { SignalSample } from "./useLiveSession";

const WIDTH = 550;
const HEIGHT = 150;
const MID_Y = 75;
const AMPLITUDE = 32;
const MAX_Z = 2.5;
const CAPACITY = 120;
const GRID_LINES = [30, 75, 120];

const clamp = (value: number) => Math.max(-MAX_Z, Math.min(MAX_Z, value));
const toX = (index: number) => (index / (CAPACITY - 1)) * WIDTH;
const toPath = (ys: number[], offset: number) =>
  ys.map((y, index) => `${index ? "L" : "M"}${toX(index + offset).toFixed(1)} ${y.toFixed(1)}`).join(" ");

function LiveWave({ samples }: { samples: SignalSample[] }) {
  const offset = CAPACITY - samples.length;
  const signalY = samples.map((s) => MID_Y - (clamp(s.signal) / MAX_Z) * AMPLITUDE * 1.5);
  // Pacer target (0..1 height); drawn only for the samples that have one.
  const targetY = samples.map((s) => (s.target === null ? null : MID_Y - (s.target - 0.5) * 2 * AMPLITUDE));
  const hasTarget = targetY.some((y) => y !== null);
  const path = signalY.length ? toPath(signalY, offset) : "";
  const last = signalY.length - 1;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-label="Fala oddechowa i ΔHbO">
      {GRID_LINES.map((y) => (
        <line key={y} x1="0" x2={WIDTH} y1={y} y2={y} />
      ))}
      {hasTarget && (
        <path
          d={toPath(targetY.map((y) => y ?? MID_Y), offset)}
          fill="none"
          stroke="#f4a261"
          strokeWidth="2"
          strokeDasharray="6 5"
          opacity=".85"
        />
      )}
      {path && (
        <>
          <path d={path} className="breath-wave" />
          <path d={`${path} L${WIDTH} ${HEIGHT} L${toX(offset)} ${HEIGHT}Z`} className="wave-fill" />
          <line x1={WIDTH - 2} x2={WIDTH - 2} y1="8" y2="140" className="cursor-line" />
          <circle cx={WIDTH - 2} cy={signalY[last]} r="5" className="cursor-dot" />
        </>
      )}
    </svg>
  );
}

export function LiveSignalCard({
  samples,
  scoreLabel,
  score,
  stage,
}: {
  samples: SignalSample[];
  scoreLabel: string;
  score: number | null;
  stage: string;
}) {
  return (
    <GlassPanel as="article" className="live-chart-card">
      <CardHeader
        caption="SYGNAŁ W CZASIE RZECZYWISTYM"
        title="Fala oddechowa i ΔHbO"
        aside={
          <div className="coherence">
            <small>{scoreLabel}</small>
            <strong>{score === null ? "—" : `${score}%`}</strong>
          </div>
        }
      />
      <div className="live-wave">
        <LiveWave samples={samples} />
        <div className="wave-label">
          <span>{stage}</span>
          <span>linia przerywana: rytm docelowy</span>
        </div>
      </div>
    </GlassPanel>
  );
}
