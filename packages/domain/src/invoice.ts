import { secondsToHundredths } from "./duration";
import { formatMoney, lineAmount, percentOf } from "./money";
import {
  type CalendarDate,
  formatDateLong,
  formatDateRange,
  formatDayMonth,
  startOfWeek,
} from "./time";

export type LineKind = "time" | "fixed" | "manual" | "discount";
export type LineLayoutMode = "per_task" | "per_task_week" | "per_entry";

export interface LineLayout {
  mode: LineLayoutMode;
  showDates: boolean;
  showNotes: boolean;
}

export const DEFAULT_LAYOUT: LineLayout = { mode: "per_entry", showDates: true, showNotes: true };

// ---------------------------------------------------------------------------------------------
// Totals (07 §6 steps 3–7, §7)
// ---------------------------------------------------------------------------------------------

export interface LineInput {
  kind: LineKind;
  qtyHundredths: number;
  rateMinor: number;
  /** ids of the version taxes this line carries */
  taxIds: string[];
  /** a percentage discount; its amount follows the other lines while unfrozen (07 §7.2) */
  discountRateBp?: number | null;
}

export interface TaxInput {
  id: string;
  name: string;
  rateBp: number;
}

export interface ComputedLine {
  qtyHundredths: number;
  rateMinor: number;
  amountMinor: number;
}

export interface ComputedTax extends TaxInput {
  baseMinor: number;
  amountMinor: number;
}

export interface ComputedInvoice {
  lines: ComputedLine[];
  subtotalMinor: number;
  discountMinor: number;
  taxes: ComputedTax[];
  taxTotalMinor: number;
  totalMinor: number;
  errors: string[];
}

export function computeInvoice(lines: LineInput[], taxes: TaxInput[]): ComputedInvoice {
  const errors: string[] = [];
  const nonDiscountSum = lines
    .filter((l) => l.kind !== "discount")
    .reduce((s, l) => s + lineAmount(l.qtyHundredths, l.rateMinor), 0);

  if (lines.filter((l) => l.kind === "discount").length > 1) {
    errors.push("An invoice can have one discount line.");
  }

  const computed: ComputedLine[] = lines.map((l) => {
    if (l.kind === "discount") {
      if (l.discountRateBp != null) {
        const amount = -percentOf(nonDiscountSum, l.discountRateBp); // step 4
        return { qtyHundredths: 100, rateMinor: amount, amountMinor: amount };
      }
      const rate = -Math.abs(l.rateMinor);
      return { qtyHundredths: 100, rateMinor: rate, amountMinor: lineAmount(100, rate) };
    }
    return {
      qtyHundredths: l.qtyHundredths,
      rateMinor: l.rateMinor,
      amountMinor: lineAmount(l.qtyHundredths, l.rateMinor), // step 3
    };
  });

  const subtotalMinor = computed.reduce((s, l) => s + l.amountMinor, 0); // step 6
  const discountMinor = computed
    .filter((_, i) => lines[i].kind === "discount")
    .reduce((s, l) => s + l.amountMinor, 0);

  const computedTaxes: ComputedTax[] = taxes.map((t) => {
    const baseMinor = lines.reduce(
      (s, l, i) => (l.taxIds.includes(t.id) ? s + computed[i].amountMinor : s),
      0,
    );
    if (baseMinor < 0) errors.push(`The ${t.name} base can't go below zero.`);
    return { ...t, baseMinor, amountMinor: percentOf(baseMinor, t.rateBp) }; // step 5
  });
  const taxTotalMinor = computedTaxes.reduce((s, t) => s + t.amountMinor, 0);
  const totalMinor = subtotalMinor + taxTotalMinor; // step 7
  if (totalMinor < 0) errors.push("The total can't go below zero.");

  return {
    lines: computed,
    subtotalMinor,
    discountMinor,
    taxes: computedTaxes,
    taxTotalMinor,
    totalMinor,
    errors,
  };
}

// ---------------------------------------------------------------------------------------------
// Building lines from entries (Guide §5.13 layouts, S9)
// ---------------------------------------------------------------------------------------------

export interface BillableEntry {
  id: string;
  date: CalendarDate;
  seconds: number;
  note: string;
  taskId: string;
  projectName: string;
  taskName: string;
  rateMinor: number | null;
}

export interface BuiltLine {
  kind: LineKind;
  taskId: string | null;
  title: string;
  detail: string;
  qtyHundredths: number;
  unit: string;
  rateMinor: number;
  entryIds: string[];
  entrySeconds: Record<string, number>;
  sourceFingerprint: string;
  discountRateBp?: number | null;
}

/** FNV-1a, enough to detect "lines out of date" (08 §5.2). Works in the browser too. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function entriesFingerprint(entries: BillableEntry[], layout: LineLayout): string {
  return fingerprint(
    JSON.stringify([
      layout,
      entries.map((e) => [
        e.id,
        e.date,
        e.seconds,
        e.taskId,
        e.rateMinor,
        layout.showNotes ? e.note : "",
      ]),
    ]),
  );
}

function sortEntries(entries: BillableEntry[]): BillableEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.projectName.localeCompare(b.projectName) ||
      a.taskName.localeCompare(b.taskName) ||
      a.id.localeCompare(b.id),
  );
}

function notesList(entries: BillableEntry[]): string {
  return entries
    .map((e) => e.note.trim())
    .filter(Boolean)
    .map((n) => `- ${n.split("\n")[0].replace(/^[-*]\s+/, "")}`)
    .join("\n");
}

function groupLine(entries: BillableEntry[], layout: LineLayout, title: string): BuiltLine {
  const seconds = entries.reduce((s, e) => s + e.seconds, 0);
  const dates = entries.map((e) => e.date).sort();
  const parts: string[] = [];
  if (layout.showDates) {
    parts.push(
      `${formatDateRange(dates[0], dates[dates.length - 1])} · ${entries.length} ${entries.length === 1 ? "entry" : "entries"}`,
    );
  }
  if (layout.showNotes) {
    const notes = notesList(entries);
    if (notes) parts.push(notes);
  }
  return {
    kind: "time",
    taskId: entries[0].taskId,
    title,
    detail: parts.join("\n"),
    qtyHundredths: secondsToHundredths(seconds), // summed first, then rounded once (M3)
    unit: "h",
    rateMinor: entries[0].rateMinor ?? 0,
    entryIds: entries.map((e) => e.id),
    entrySeconds: Object.fromEntries(entries.map((e) => [e.id, e.seconds])),
    sourceFingerprint: entriesFingerprint(entries, layout),
  };
}

export function buildTimeLines(
  input: BillableEntry[],
  layout: LineLayout,
  weekStart = 1,
): BuiltLine[] {
  const entries = sortEntries(input);
  if (layout.mode === "per_entry") {
    return entries.map((e) => ({
      kind: "time" as const,
      taskId: e.taskId,
      title: `${formatDateLong(e.date)} · ${e.projectName} · ${e.taskName}`,
      detail: layout.showNotes ? e.note.trim() : "",
      qtyHundredths: secondsToHundredths(e.seconds),
      unit: "h",
      rateMinor: e.rateMinor ?? 0,
      entryIds: [e.id],
      entrySeconds: { [e.id]: e.seconds },
      sourceFingerprint: entriesFingerprint([e], layout),
    }));
  }
  const groups = new Map<string, BillableEntry[]>();
  for (const e of entries) {
    const key =
      layout.mode === "per_task_week" ? `${e.taskId}|${startOfWeek(e.date, weekStart)}` : e.taskId;
    const g = groups.get(key);
    if (g) g.push(e);
    else groups.set(key, [e]);
  }
  const lines = [...groups.entries()].map(([key, g]) => {
    const base = `${g[0].projectName} · ${g[0].taskName}`;
    const title =
      layout.mode === "per_task_week"
        ? `${base} · week of ${formatDayMonth(key.split("|")[1])}`
        : base;
    return groupLine(g, layout, title);
  });
  return lines.sort((a, b) => a.title.localeCompare(b.title));
}

export function buildFixedLine(input: {
  taskId: string;
  projectName: string;
  taskName: string;
  currency: string;
  feeMinor: number;
  remainingMinor: number;
  amountMinor: number;
}): BuiltLine {
  const whole = input.amountMinor === input.feeMinor && input.remainingMinor === input.feeMinor;
  const after = input.remainingMinor - input.amountMinor;
  const fee = formatMoney({ minor: input.feeMinor, currency: input.currency });
  return {
    kind: "fixed",
    taskId: input.taskId,
    title: `${input.projectName} · ${input.taskName}`,
    detail: whole
      ? "Fixed fee"
      : `Part of ${fee} fixed fee · ${formatMoney({ minor: after, currency: input.currency })} remaining after this invoice`,
    qtyHundredths: 100,
    unit: "fixed",
    rateMinor: input.amountMinor,
    entryIds: [],
    entrySeconds: {},
    sourceFingerprint: fingerprint(`${input.taskId}|${input.feeMinor}`),
  };
}

/** 08 §5.1: does an edit to these entry fields change the printed document? */
export function affectsDocument(changedFields: string[], layout: LineLayout): boolean {
  const always = [
    "date",
    "started_at",
    "ended_at",
    "duration_seconds",
    "task_id",
    "billable",
    "segments",
    "deleted_at",
  ];
  if (changedFields.some((f) => always.includes(f))) return true;
  const notesPrint = layout.mode === "per_entry" || layout.showNotes;
  return notesPrint && changedFields.includes("note");
}

/** Light Markdown subset for notes (Guide §5.13): bullet lists, line breaks, links as text. */
export type NoteBlock = { type: "p"; text: string } | { type: "ul"; items: string[] };

export function parseNote(note: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", text: para.join("\n") });
    para = [];
  };
  const flushList = () => {
    if (list?.length) blocks.push({ type: "ul", items: list });
    list = null;
  };
  for (const raw of note.split("\n")) {
    const m = raw.match(/^\s*[-*]\s+(.*)$/);
    if (m) {
      flushPara();
      if (!list) list = [];
      list.push(m[1]);
    } else if (raw.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(raw);
    }
  }
  flushPara();
  flushList();
  return blocks;
}
