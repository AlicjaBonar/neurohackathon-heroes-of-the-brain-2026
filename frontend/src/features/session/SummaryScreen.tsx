import type { Summary } from "@/api/types";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { CardHeader, GlassPanel, ProgressBar } from "@/components/ui/Card";
import { ScreenTitle } from "@/components/ui/Page";
import { formatDuration } from "@/lib/utils";
import { PHASE_LABELS } from "./labels";

const num = (v: number | null | undefined, digits = 0) => (v == null ? "—" : v.toFixed(digits));
const signed = (v: number | null | undefined, unit: string) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v}${unit}`;

function CompareRow({ label, before, after, delta, unit }: {
  label: string; before?: number | null; after?: number | null; delta?: string; unit: string;
}) {
  return (
    <tr>
      <th>{label}</th>
      <td>{num(before, 1)} {unit}</td>
      <td>{num(after, 1)} {unit}</td>
      <td>{delta ?? "—"}</td>
    </tr>
  );
}

export function SummaryScreen({ summary, onDone }: { summary: Summary; onDone: () => void }) {
  const { before, after, delta, scores, holds, movement, recovery, quality, insights, sources } = summary;
  const bars = [
    scores?.relaxation !== undefined && { label: "Relaksacja", value: scores.relaxation },
    scores?.resonance !== undefined && { label: "Rezonans", value: scores.resonance },
    scores?.phase_lock != null && { label: "Zgodność z rytmem", value: Math.round(scores.phase_lock * 100) },
  ].filter(Boolean) as { label: string; value: number }[];
  const simulated = Object.entries(sources).filter(([, v]) => v === "simulated").map(([k]) => k);

  return (
    <AppShell>
      <ScreenTitle
        eyebrow={`SESJA • ${formatDuration(Math.round(summary.duration_s))} MIN`}
        title="Podsumowanie sesji"
        description={PHASE_LABELS[summary.exercise] ?? summary.exercise}
        aside={<Button onClick={onDone}>Gotowe</Button>}
      />
      <section className="summary-grid">
        {before && after && (
          <GlassPanel className="summary-compare">
            <CardHeader caption="PRZED I PO" title="Spoczynek" />
            <table>
              <thead><tr><th /><th>Przed</th><th>Po</th><th>Zmiana</th></tr></thead>
              <tbody>
                <CompareRow label="Tętno" before={before.hr_bpm} after={after.hr_bpm} unit="BPM"
                  delta={signed(delta?.hr_bpm, " BPM")} />
                <CompareRow label="HRV (RMSSD)" before={before.rmssd_ms} after={after.rmssd_ms} unit="ms"
                  delta={signed(delta?.rmssd_pct, "%")} />
                <CompareRow label="Oddech" before={before.resp_rate_bpm} after={after.resp_rate_bpm} unit="/min"
                  delta={signed(delta?.resp_rate_bpm, "/min")} />
              </tbody>
            </table>
          </GlassPanel>
        )}

        <GlassPanel as="article" className="summary-card">
          <CardHeader caption="WYNIKI" title="Ćwiczenie" />
          <div className="summary-bars">
            {bars.map((bar) => (
              <div key={bar.label}>
                <span>{bar.label}</span>
                <ProgressBar value={bar.value} />
                <strong>{bar.value}%</strong>
              </div>
            ))}
          </div>
          {holds.length > 0 && (
            <p>Bezdech: {holds.map((h) => `${h.hold_s.toFixed(0)} s`).join(", ")}</p>
          )}
          {movement.map((m, i) => (
            <p key={i}>Ruch „{m.target}”: {m.detected_reps}/{m.reps} {m.verified ? "✓" : "✗"}</p>
          ))}
          {recovery && <p>Spadek tętna w 1. minucie: {recovery.drop_1min_bpm} BPM (symulacja)</p>}
          {!bars.length && !holds.length && !movement.length && !recovery && (
            <p className="empty-note">To ćwiczenie nie ma wyniku punktowego.</p>
          )}
        </GlassPanel>

        <GlassPanel className="summary-insights">
          <CardHeader caption="SPOSTRZEŻENIA" title="Co z tego wynika" />
          <ul>
            {insights.map((insight, i) => (
              <li key={i} className={`insight-${insight.kind}`}>{insight.text}</li>
            ))}
            {!insights.length && <li>Zbyt mało danych na wnioski.</li>}
          </ul>
          <small className="summary-quality">
            Jakość pomiaru: {num(quality.good_pct)}% dobrych kanałów · ruch: {quality.motion_s} s
            {simulated.length > 0 && ` · symulowane: ${simulated.join(", ")}`}
          </small>
        </GlassPanel>
      </section>
    </AppShell>
  );
}
