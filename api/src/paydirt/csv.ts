/**
 * Paydirt's time log export (docs/paypure/05 §1): one row per entry. Notes are quoted and may
 * span lines, so this is a real RFC 4180 reader, not a split on newlines.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Rows as objects by header. Paydirt leaves trailing empty cells off, so missing cells read "". */
export function csvObjects(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export interface PaydirtTimeRow {
  /** 1-based row number in the file (header excluded), for messages */
  row: number;
  startDate: string;
  /** "HH:MM" 24h, or null for a duration-only row */
  startTime: string | null;
  endDate: string;
  endTime: string | null;
  client: string;
  project: string;
  task: string;
  user: string;
  note: string;
  hundredths: number;
  rateMinor: number;
  priceMinor: number;
  /** invoice number text as Paydirt prints it ("005"), or null when unbilled */
  invoicedIn: string | null;
}

const WHEN = /^(\d{4}-\d{2}-\d{2})(?: (\d{1,2}):(\d{2})(am|pm))?$/;

function when(s: string, row: number, col: string): { date: string; time: string | null } {
  const m = WHEN.exec(s.trim());
  if (!m) throw new Error(`time log row ${row}: can't read ${col} "${s}"`);
  if (!m[2]) return { date: m[1], time: null };
  let h = Number(m[2]) % 12;
  if (m[4] === "pm") h += 12;
  return { date: m[1], time: `${String(h).padStart(2, "0")}:${m[3]}` };
}

/** "17.0" → 1700, "32.5" → 3250. Paydirt prints at most 2 dp. */
export function hundredths(s: string): number {
  const v = Number(s);
  if (!Number.isFinite(v)) throw new Error(`not a number: "${s}"`);
  return Math.round(v * 100);
}

export function readTimeLog(text: string): PaydirtTimeRow[] {
  return csvObjects(text).map((o, i) => {
    const row = i + 1;
    const start = when(o["Start time"], row, "Start time");
    const end = when(o["End time"], row, "End time");
    const inv = o["Invoiced in"].trim();
    return {
      row,
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time,
      client: o.Client.trim(),
      project: o.Project.trim(),
      task: o.Job.trim(),
      user: o.User.trim(),
      note: o.Description.replace(/\r\n/g, "\n").trim(),
      hundredths: hundredths(o["Duration in hours"]),
      rateMinor: hundredths(o["Hourly rate"]),
      priceMinor: hundredths(o.Price),
      invoicedIn: inv || null,
    };
  });
}

export interface PaymentRow {
  number: string;
  status: "paid" | "open";
  paidOn: string | null;
  amountMinor: number | null;
  note: string;
}

/** data/paydirt-payments.csv (05 §3.9): number,status,paid_on,amount,note */
export function readPayments(text: string): PaymentRow[] {
  return csvObjects(text).map((o, i) => {
    const status = o.status.trim();
    if (status !== "paid" && status !== "open") throw new Error(`payments row ${i + 1}: status must be paid or open, not "${status}"`);
    if (status === "paid" && !/^\d{4}-\d{2}-\d{2}$/.test(o.paid_on)) throw new Error(`payments row ${i + 1}: paid_on "${o.paid_on}" isn't a date`);
    return {
      number: o.number.trim(),
      status,
      paidOn: o.paid_on.trim() || null,
      amountMinor: o.amount.trim() ? hundredths(o.amount) : null,
      note: o.note.trim(),
    };
  });
}
