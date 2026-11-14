/** fNIRS sampling rate shown in the header (mocked until the live stream is wired up). */
export const SENSOR_RATE_LABEL = "141.79 Hz";

/** Joins truthy class names into a single `className` string. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const pad = (value: number) => value.toString().padStart(2, "0");

/** Formats a number of seconds as `MM:SS`. */
export function formatDuration(totalSeconds: number): string {
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
}

/** Formats a 0-based list index as a 1-based, zero-padded ordinal: 0 → "01". */
export function formatOrdinal(index: number): string {
  return pad(index + 1);
}

export type TrendDirection = "up" | "down";

/** Prefixes a change value with a trend arrow: ("up", "+21%") → "↑ +21%". */
export function formatTrend(direction: TrendDirection, value: string): string {
  return `${direction === "up" ? "↑" : "↓"} ${value}`;
}

/** Strips every non-digit character from user input. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}
