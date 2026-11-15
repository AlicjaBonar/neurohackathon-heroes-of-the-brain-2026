import type { ChannelQuality, ChannelStatus, Probe, QualityMsg } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/utils";
import type { HoldRecord } from "./useLiveSession";
import { WARNING_TEXT } from "./labels";

// ------------------------------------------------------------------ signal check

const STATUS: Record<ChannelStatus, { label: string; color: string }> = {
  good: { label: "good", color: "#10b981" },
  weak: { label: "weak", color: "#f59e0b" },
  saturated: { label: "saturated", color: "#ef4444" },
  dark: { label: "no light", color: "#64748b" },
};

/**
 * Before the protocol starts: channel contact on a top view of the head (from `quality`, 1 Hz),
 * like the calibration step of the real device. Starts by itself once the signal is ready.
 */
export function SignalCheck({
  probe,
  quality,
  onStart,
}: {
  probe: Probe | null;
  quality: QualityMsg | null;
  onStart: () => void;
}) {
  const byPair = new Map<string, ChannelQuality>((quality?.channels ?? []).map((c) => [c.pair, c]));
  const pairs = probe?.pairs.filter((p) => !p.short) ?? [];
  const counts = (Object.keys(STATUS) as ChannelStatus[]).map((k) => ({
    k,
    n: pairs.filter((p) => byPair.get(p.pair)?.status === k).length,
  }));
  const ready = !!quality?.ready;
  const warning = quality?.warnings[0];
  const R = 100;
  const P = (x: number, y: number) => [120 + x * R, 118 - y * R] as const;

  return (
    <div className="signal-check">
      <span className="sum-caption">SIGNAL CHECK</span>
      <h2>{ready ? "Signal looks good" : "Checking sensor contact…"}</h2>
      <svg viewBox="0 0 240 240" className="check-head" role="img" aria-label="Channel contact quality on the head">
        <path d="M108 20 L120 6 L132 20" className="head-line" />
        <ellipse cx={120 - R - 4} cy={118} rx={7} ry={17} className="head-line" />
        <ellipse cx={120 + R + 4} cy={118} rx={7} ry={17} className="head-line" />
        <circle cx={120} cy={118} r={R} className="head-line head-fill" />
        {pairs.map((p) => {
          const q = byPair.get(p.pair);
          const [x, y] = P(p.x, p.y);
          return (
            <circle key={p.pair} cx={x} cy={y} r={pairs.length > 30 ? 3.2 : 5} fill={q ? STATUS[q.status].color : "#cbd5e1"}>
              <title>{`${p.pair} • ${p.label}: ${q ? `${STATUS[q.status].label}, SCI ${q.sci.toFixed(2)}` : "waiting"}`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="check-legend">
        {counts.map(({ k, n }) => (
          <span key={k}>
            <i style={{ background: STATUS[k].color }} /> {STATUS[k].label} <b>{n}</b>
          </span>
        ))}
      </div>
      <p className={cx("check-status", ready ? "ok" : "wait")}>
        {quality
          ? ready
            ? `${Math.round(quality.good_pct)}% of channels have good contact – starting in a moment.`
            : warning
              ? WARNING_TEXT[warning.code] ?? warning.text
              : `${Math.round(quality.good_pct)}% of channels have good contact.`
          : "Connecting to the sensor…"}
      </p>
      <Button variant={ready ? "primary" : "ghost"} onClick={onStart} disabled={!quality}>
        {ready ? "Start now" : "Start anyway"}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ resonance breathing

/** 3 sets × 5 paced breaths, filled as the cycle events arrive. */
export function SetsProgress({ cycles }: { cycles: number }) {
  return (
    <div className="ex-widget">
      <span className="sum-caption">PACED SETS</span>
      <div className="sets-row">
        {[0, 1, 2].map((set) => (
          <div key={set} className="set">
            <small>Set {set + 1}</small>
            <div>
              {[0, 1, 2, 3, 4].map((i) => {
                const n = set * 5 + i + 1;
                return <i key={i} className={cx(n <= cycles && "done", n === cycles + 1 && "next")} />;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ breath holds

/** One bar per hold: HbO rise (live while holding), with the hold duration below. */
export function HoldBars({ holds, total }: { holds: HoldRecord[]; total: number }) {
  const slots = Math.max(total, holds.length);
  const max = Math.max(0.2, ...holds.map((h) => h.rise ?? 0));
  return (
    <div className="ex-widget">
      <span className="sum-caption">HbO RESPONSE PER HOLD</span>
      <div className="hold-bars">
        {Array.from({ length: slots }, (_, i) => {
          const h = holds[i];
          const rise = Math.max(0, h?.rise ?? 0);
          return (
            <div key={i} className={cx("hold-bar", h && h.endT === null && "active", !h && "empty")}>
              <b>{h?.rise != null ? `+${rise.toFixed(2)}` : ""}</b>
              <i style={{ height: `${h ? Math.max(4, (rise / max) * 100) : 4}%` }} />
              <small>{h ? (h.holdS != null ? `${h.holdS.toFixed(0)} s` : "…") : i + 1}</small>
            </div>
          );
        })}
      </div>
      <p className="ex-note">µM of oxygenated blood in the forehead – it rises as CO₂ builds up during the hold.</p>
    </div>
  );
}

/** Count-up over the avatar during a maximal hold, then the result. */
export function HoldCounter({ seconds, best, done }: { seconds: number; best: number | null; done: boolean }) {
  const record = best !== null && seconds > best;
  return (
    <div className={cx("hold-counter", done && "done", record && "record")} role="timer" aria-live="polite">
      <small>{done ? "BREATH HOLD" : "HOLDING"}</small>
      <strong>{Math.floor(seconds)}</strong>
      <span>
        {done
          ? record
            ? "seconds – new personal best!"
            : "seconds – breathe normally now"
          : best !== null
            ? record
              ? "new personal best – keep going"
              : `seconds • your best ${best.toFixed(0)} s`
            : "seconds – press I'm done when you breathe"}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ HR recovery

/** Heart rate since the recovery started, with the 60 s mark. */
export function RecoveryCurve({ points, peak }: { points: { t: number; bpm: number }[]; peak: number | null }) {
  const W = 300;
  const H = 110;
  const T = 120;
  const vals = points.map((p) => p.bpm);
  const lo = Math.min(...vals, peak ?? 60) - 4;
  const hi = Math.max(...vals, peak ?? 100) + 4;
  const x = (t: number) => (t / T) * W;
  const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (H - 16);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.bpm).toFixed(1)}`).join(" ");
  return (
    <div className="ex-widget">
      <span className="sum-caption">HEART RATE RECOVERY</span>
      <svg viewBox={`0 0 ${W} ${H}`} className="recovery-svg" role="img" aria-label="Heart rate during recovery">
        <line x1={x(60)} x2={x(60)} y1={0} y2={H} className="rec-mark" />
        <text x={x(60) + 4} y={12} className="rec-label">60 s</text>
        {peak !== null && <line x1={0} x2={W} y1={y(peak)} y2={y(peak)} className="rec-peak" />}
        {d && <path d={d} className="rec-line" />}
      </svg>
      <p className="ex-note">A drop of 12 bpm or more in the first minute is a sign of good fitness (simulated).</p>
    </div>
  );
}
