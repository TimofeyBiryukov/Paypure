import { TZDate } from "@date-fns/tz";

/**
 * Time helpers (06 §3.1). Three kinds of value: instants (Date / ISO with Z), calendar dates
 * ("YYYY-MM-DD" strings, never turned into a JS Date at midnight) and durations (seconds).
 * Every conversion takes an explicit zone.
 */
export type CalendarDate = string;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function parseDate(d: CalendarDate): { y: number; m: number; d: number } {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, d: day };
}

export function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseDate(s);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Local calendar date of an instant in a zone. */
export function toLocalDate(instant: Date | string, tz: string): CalendarDate {
  const t = new TZDate(new Date(instant).getTime(), tz);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

export function todayIn(tz: string, now: Date = new Date()): CalendarDate {
  return toLocalDate(now, tz);
}

/** "HH:mm" of an instant in a zone. */
export function toLocalTime(instant: Date | string, tz: string): string {
  const t = new TZDate(new Date(instant).getTime(), tz);
  return `${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

export function formatTime(
  instant: Date | string,
  tz: string,
  format: "12h" | "24h" = "24h",
): string {
  const hhmm = toLocalTime(instant, tz);
  if (format === "24h") return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${suffix}`;
}

export type WallTimeResult =
  | { ok: true; instant: Date }
  | { ok: false; reason: "nonexistent"; suggestion: string };

/**
 * Wall time on a calendar date in a zone → instant (06 §3.5). A time skipped by DST is rejected
 * with a suggestion; an ambiguous time takes the first occurrence.
 */
export function fromWallTime(date: CalendarDate, hhmm: string, tz: string): WallTimeResult {
  const { y, m, d } = parseDate(date);
  const [h, min] = hhmm.split(":").map(Number);
  const t = new TZDate(y, m - 1, d, h, min, 0, tz);
  if (t.getHours() !== h || t.getMinutes() !== min) {
    return {
      ok: false,
      reason: "nonexistent",
      suggestion: `${pad(t.getHours())}:${pad(t.getMinutes())}`,
    };
  }
  return { ok: true, instant: new Date(t.getTime()) };
}

export function addDays(date: CalendarDate, n: number): CalendarDate {
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekday(date: CalendarDate): number {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Start of the week containing `date`. weekStart: 0 = Sunday, 1 = Monday. */
export function startOfWeek(date: CalendarDate, weekStart = 1): CalendarDate {
  const diff = (weekday(date) - weekStart + 7) % 7;
  return addDays(date, -diff);
}

export function daysBetween(a: CalendarDate, b: CalendarDate): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

/** "16 Nov 2026" */
export function formatDateLong(date: CalendarDate): string {
  const { y, m, d } = parseDate(date);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Mon 16 Nov" */
export function formatDateShort(date: CalendarDate): string {
  const { m, d } = parseDate(date);
  return `${WEEKDAYS[weekday(date)]} ${d} ${MONTHS[m - 1]}`;
}

/** "16 Nov" */
export function formatDayMonth(date: CalendarDate): string {
  const { m, d } = parseDate(date);
  return `${d} ${MONTHS[m - 1]}`;
}

/** Relative when recent (Guide §5.7): Today, Yesterday, Mon 16 Nov, 16 Nov 2025. */
export function formatDateRelative(date: CalendarDate, today: CalendarDate): string {
  const diff = daysBetween(date, today);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff === -1) return "Tomorrow";
  if (parseDate(date).y === parseDate(today).y) return formatDateShort(date);
  return formatDateLong(date);
}

/** "2–28 Nov", "28 Oct–3 Nov", "28 Dec 2025–3 Jan 2026" */
export function formatDateRange(from: CalendarDate, to: CalendarDate): string {
  if (from === to) return formatDayMonth(from);
  const a = parseDate(from);
  const b = parseDate(to);
  if (a.y !== b.y) return `${formatDateLong(from)}–${formatDateLong(to)}`;
  if (a.m === b.m) return `${a.d}–${b.d} ${MONTHS[b.m - 1]}`;
  return `${formatDayMonth(from)}–${formatDayMonth(to)}`;
}
