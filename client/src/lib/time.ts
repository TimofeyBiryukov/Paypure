import { toLocalTime } from "@paypure/domain";

export interface EntryRow {
  id: string;
  state: "running" | "paused" | "stopped";
  date: string;
  timeZone: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  segments: { startedAt: string; endedAt: string | null }[];
  note: string;
  billable: boolean;
  version: number;
  member: { id: string; name: string };
  task: {
    id: string;
    name: string;
    billingMode: "hourly" | "fixed" | "non_billable";
    projectId: string;
    projectName: string;
    clientId: string;
    clientName: string;
    colour: number;
    currency: string;
  } | null;
  invoice: { id: string; number: string | null; status: "draft" | "issued" | "void" } | null;
  offInvoice: "billed_elsewhere" | "written_off" | null;
  offInvoiceRef: string | null;
  changePending: boolean;
  valueMinor?: number | null;
  rate?: { rateMinor: number; source: string } | null;
}

export interface Gap {
  from: string;
  to: string;
  seconds: number;
}

/**
 * Gaps over 5 minutes on a member's day, computed from segments (06 §2.10). Breaks inside an
 * entry are deliberate and are not gaps; duration-only entries neither create nor close gaps.
 */
export function computeGaps(entries: EntryRow[], nowIso?: string): Gap[] {
  const spans = entries
    .filter((e) => e.startedAt)
    .map((e) => ({
      from: Date.parse(e.startedAt as string),
      to: Date.parse(e.endedAt ?? nowIso ?? new Date().toISOString()),
    }))
    .sort((a, b) => a.from - b.from);
  const gaps: Gap[] = [];
  let cursor: number | null = null;
  for (const s of spans) {
    if (cursor !== null && s.from - cursor > 5 * 60_000) {
      gaps.push({
        from: new Date(cursor).toISOString(),
        to: new Date(s.from).toISOString(),
        seconds: Math.round((s.from - cursor) / 1000),
      });
    }
    cursor = cursor === null ? s.to : Math.max(cursor, s.to);
  }
  return gaps;
}

export function entryRange(e: EntryRow, tz: string): string {
  if (!e.startedAt) return "—";
  const zone = e.timeZone !== tz ? e.timeZone : tz;
  const start = toLocalTime(e.startedAt, zone);
  const end = e.endedAt ? toLocalTime(e.endedAt, zone) : "now";
  const plusDay =
    e.endedAt && e.endedAt.slice(0, 10) !== e.startedAt.slice(0, 10) && end < start ? " +1" : "";
  const label = e.timeZone !== tz ? ` ${shortZone(e.timeZone)}` : "";
  return `${start}–${end}${plusDay}${label}`;
}

function shortZone(tz: string) {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? tz
    );
  } catch {
    return tz;
  }
}
