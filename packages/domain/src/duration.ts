import { roundHalfAway } from "./money";

/** Step 2 (07 §6): Σ seconds → hundredths of an hour, rounded once. 1 hundredth = 36 s. */
export function secondsToHundredths(seconds: number): number {
  return roundHalfAway(seconds / 36);
}

/** UI durations are h:mm (Guide §5.7). */
export function formatDuration(seconds: number, opts: { withSeconds?: boolean } = {}): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (opts.withSeconds) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Week totals: 32h 15m. */
export function formatHoursMinutes(seconds: number): string {
  const totalMin = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Invoices: decimal hours, 2 dp. */
export function formatHundredths(qtyHundredths: number): string {
  return (qtyHundredths / 100).toFixed(2);
}

/**
 * Duration input accepts `1.5`, `1h30`, `90m`, `1:30`, `2h` (Guide §5.2). Returns seconds.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) {
    const mins = Number(m[2]);
    if (mins >= 60) return null;
    return Number(m[1]) * 3600 + mins * 60;
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)h(?:(\d+)m?)?$/))) {
    return Math.round(Number(m[1]) * 3600) + (m[2] ? Number(m[2]) * 60 : 0);
  }
  if ((m = s.match(/^(\d+)m(?:in)?$/))) return Number(m[1]) * 60;
  if ((m = s.match(/^(\d+(?:[.,]\d+)?)$/)))
    return Math.round(Number(m[1].replace(",", ".")) * 3600);
  return null;
}

/**
 * Time input accepts `9`, `930`, `9:30`, `9:30p`, `21:15` (Guide §5.2). Returns "HH:mm" or null.
 * `now` is resolved by the caller, who knows the zone.
 */
export function parseTimeOfDay(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, ":");
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap.startsWith("p") && h !== 12) h += 12;
    if (ap.startsWith("a") && h === 12) h = 0;
  }
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
