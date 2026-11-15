import type { ChannelQuality, ChannelStatus, Probe, QualityMsg } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/utils";
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

// ------------------------------------------------------------------ breath holds

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
            : "seconds – the end is detected automatically"}
      </span>
    </div>
  );
}
