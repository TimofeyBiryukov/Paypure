import {
  addDays,
  daysBetween,
  fromWallTime,
  lineAmount,
  secondsToHundredths,
  toLocalDate,
} from "@paypure/domain";
import type { PaydirtTimeRow, PaymentRow } from "./csv";
import type { PdfFrom, PdfInvoice } from "./pdf";
import { paymentSnapshot } from "./pdf";

/**
 * The Paydirt import as data (docs/paypure/05 §4): everything the load step writes, plus the
 * checks. Building it touches no database, so --dry-run is this function and a report.
 */

export interface Overrides {
  timeZone: string;
  nextNumber: number;
  numberHoles: string[];
  clients: Record<string, { active: boolean; billingEmails: string[] }>;
  staleUnbilled: {
    cutoff: string;
    default: { kind: "written_off" | "billed_elsewhere"; ref: string; note?: string };
    byClient?: Record<string, { kind: "written_off" | "billed_elsewhere"; ref: string; note?: string }>;
  };
}

export interface PdfSource {
  folder: string;
  path: string;
  invoice: PdfInvoice;
}

export interface ClientPlan {
  key: string;
  name: string;
  contactName: string;
  address: string;
  currency: string;
  termsDays: number | null;
  billingEmails: string[];
  archived: boolean;
  colour: number;
}
export interface ProjectPlan {
  key: string;
  clientKey: string;
  name: string;
  rateMinor: number | null;
  completed: boolean;
}
export interface TaskPlan {
  key: string;
  projectKey: string;
  name: string;
  billingMode: "hourly" | "non_billable";
  rateMinor: number | null;
  doneOn: string | null;
  position: number;
}
export interface EntryPlan {
  csvRow: number;
  taskKey: string;
  date: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number;
  note: string;
  billable: boolean;
  invoiceNumber: string | null;
  off: { kind: "written_off" | "billed_elsewhere"; ref: string; note: string | null } | null;
}
export interface LinePlan {
  kind: "time" | "manual";
  taskKey: string | null;
  title: string;
  detail: string;
  qtyHundredths: number;
  unit: string;
  rateMinor: number;
  amountMinor: number;
}
export interface InvoicePlan {
  number: string;
  seq: number;
  clientKey: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  termsDays: number;
  summary: string;
  from: PdfFrom;
  to: { name: string; contactName: string; address: string; taxId: string; emails: string[] };
  account: ReturnType<typeof paymentSnapshot> | null;
  lines: LinePlan[];
  totalMinor: number;
  pdfPath: string;
  payment: { paidOn: string; amountMinor: number; note: string } | null;
}

export interface Plan {
  timeZone: string;
  nextNumber: number;
  profile: PdfFrom;
  account: ReturnType<typeof paymentSnapshot>;
  clients: ClientPlan[];
  projects: ProjectPlan[];
  tasks: TaskPlan[];
  entries: EntryPlan[];
  invoices: InvoicePlan[];
  errors: string[];
  warnings: string[];
  report: string[];
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
const key = (...parts: string[]) => parts.join(" › ");
const money = (m: number, cur = "") => `${(m / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ""}`;

export function buildPlan(input: {
  rows: PaydirtTimeRow[];
  pdfs: PdfSource[];
  payments: PaymentRow[];
  overrides: Overrides;
  today: string;
}): Plan {
  const { rows, pdfs, payments, overrides: ov } = input;
  const tz = ov.timeZone;
  const errors: string[] = [];
  const warnings: string[] = [];
  const report: string[] = [];
  const say = (s = "") => report.push(s);

  // ── Invoices: numbers, totals, holes ────────────────────────────────────────────────────
  const byNumber = new Map<string, PdfSource>();
  for (const p of pdfs) {
    if (byNumber.has(p.invoice.number)) errors.push(`#${p.invoice.number} has two PDFs`);
    byNumber.set(p.invoice.number, p);
    const sum = p.invoice.lines.reduce((s, l) => s + l.amountMinor, 0);
    if (sum !== p.invoice.totalMinor || p.invoice.subtotalMinor !== p.invoice.totalMinor) {
      errors.push(`#${p.invoice.number}: lines add up to ${money(sum)}, the PDF total is ${money(p.invoice.totalMinor)}`);
    }
    for (const l of p.invoice.lines) {
      if (lineAmount(l.qtyHundredths, l.rateMinor) !== l.amountMinor) {
        errors.push(`#${p.invoice.number}: "${l.title.slice(0, 40)}" fails the line-math check (${l.qtyHundredths / 100} × ${money(l.rateMinor)} ≠ ${money(l.amountMinor)})`);
      }
    }
  }
  const numbers = [...byNumber.keys()].sort((a, b) => Number(a) - Number(b));
  const maxSeq = Math.max(...numbers.map(Number));
  const holes: string[] = [];
  for (let i = 1; i <= maxSeq; i++) {
    const n = String(i).padStart(3, "0");
    if (!byNumber.has(n)) holes.push(n);
  }
  const holesExpected = new Set(ov.numberHoles);
  const unexpectedHoles = holes.filter((h) => !holesExpected.has(h));
  const filledHoles = ov.numberHoles.filter((h) => byNumber.has(h));
  if (unexpectedHoles.length) errors.push(`numbers missing from the export that overrides don't list as holes: ${unexpectedHoles.join(", ")}`);
  if (filledHoles.length) warnings.push(`overrides list ${filledHoles.join(", ")} as holes, but the export has them`);
  if (ov.nextNumber !== maxSeq + 1) errors.push(`overrides say the next number is ${ov.nextNumber}, the export ends at #${maxSeq}`);

  // ── Clients ──────────────────────────────────────────────────────────────────────────────
  const clientNames = [...new Set(rows.map((r) => r.client))];
  const folders = [...new Set(pdfs.map((p) => p.folder))];
  const folderClient = new Map<string, string>();
  for (const f of folders) {
    const c = clientNames.find((n) => slug(n) === f);
    if (!c) errors.push(`invoice folder "${f}" matches no client in the time log`);
    else folderClient.set(f, c);
  }
  for (const name of Object.keys(ov.clients)) {
    if (!clientNames.includes(name)) errors.push(`overrides name a client the time log doesn't have: "${name}"`);
  }
  const invoicesOf = (client: string) =>
    pdfs.filter((p) => folderClient.get(p.folder) === client).sort((a, b) => a.invoice.issueDate.localeCompare(b.invoice.issueDate) || Number(a.invoice.number) - Number(b.invoice.number));

  const lastActivity = (client: string) =>
    [...rows.filter((r) => r.client === client).map((r) => r.startDate), ...invoicesOf(client).map((p) => p.invoice.issueDate)].sort().pop() ?? "";
  const ordered = [...clientNames].sort((a, b) => Number(!!ov.clients[b]?.active) - Number(!!ov.clients[a]?.active) || lastActivity(b).localeCompare(lastActivity(a)));
  const clients: ClientPlan[] = ordered.map((name, i) => {
    const last = invoicesOf(name).pop()?.invoice;
    const o = ov.clients[name];
    return {
      key: name,
      name,
      contactName: last?.billedTo[1] ?? "",
      address: last?.billedTo.slice(2).join("\n") ?? "",
      currency: last?.currency ?? "USD",
      termsDays: last ? daysBetween(last.issueDate, last.dueDate) : null,
      billingEmails: o?.billingEmails ?? [],
      archived: !o?.active,
      colour: i % 10,
    };
  });
  const clientByKey = new Map(clients.map((c) => [c.key, c]));

  // ── Projects and tasks, with rates from the latest billable entry ───────────────────────
  const latest = (rs: PaydirtTimeRow[]) => [...rs].sort((a, b) => (a.startDate + (a.startTime ?? "")).localeCompare(b.startDate + (b.startTime ?? "")) || a.row - b.row).pop();
  const projects: ProjectPlan[] = [];
  const tasks: TaskPlan[] = [];
  const recentCutoff = addDays(input.today, -365);
  for (const c of clients) {
    const cr = rows.filter((r) => r.client === c.key);
    for (const pname of [...new Set(cr.map((r) => r.project))]) {
      const pr = cr.filter((r) => r.project === pname);
      const pk = key(c.key, pname);
      const pRate = latest(pr.filter((r) => r.rateMinor > 0))?.rateMinor ?? null;
      const yearOfLast = latest(pr)?.startDate.slice(0, 4) ?? "";
      projects.push({ key: pk, clientKey: c.key, name: pname, rateMinor: pRate, completed: yearOfLast < input.today.slice(0, 4) });
      let pos = 0;
      for (const tname of [...new Set(pr.map((r) => r.task))]) {
        const tr = pr.filter((r) => r.task === tname);
        const tRate = latest(tr.filter((r) => r.rateMinor > 0))?.rateMinor ?? null;
        const lastDate = latest(tr)?.startDate ?? "";
        tasks.push({
          key: key(pk, tname),
          projectKey: pk,
          name: tname,
          billingMode: tRate == null ? "non_billable" : "hourly",
          rateMinor: tRate != null && tRate !== pRate ? tRate : null,
          doneOn: lastDate < recentCutoff ? lastDate : null,
          position: pos++,
        });
      }
    }
  }
  const taskByKey = new Map(tasks.map((t) => [t.key, t]));
  const projectByKey = new Map(projects.map((p) => [p.key, p]));
  const rateOf = (taskKey: string) => {
    const t = taskByKey.get(taskKey);
    return t?.rateMinor ?? projectByKey.get(t?.projectKey ?? "")?.rateMinor ?? null;
  };

  // ── Time entries ─────────────────────────────────────────────────────────────────────────
  const users = [...new Set(rows.map((r) => r.user))];
  if (users.length !== 1) errors.push(`time is logged by ${users.length} users (${users.join(", ")}); the import maps everything to one member`);
  const entries: EntryPlan[] = [];
  let durationMismatch = 0;
  for (const r of rows) {
    const taskKey = key(r.client, r.project, r.task);
    let startedAt: Date | null = null;
    let endedAt: Date | null = null;
    let seconds: number;
    let date = r.startDate;
    if (r.startTime && r.endTime) {
      const a = fromWallTime(r.startDate, r.startTime, tz);
      const b = fromWallTime(r.endDate, r.endTime, tz);
      if (!a.ok || !b.ok) {
        errors.push(`time log row ${r.row}: ${r.startDate} ${r.startTime}–${r.endTime} doesn't exist in ${tz}`);
        continue;
      }
      const span = (b.instant.getTime() - a.instant.getTime()) / 1000;
      if (span < 0) {
        errors.push(`time log row ${r.row}: ends before it starts`);
        continue;
      }
      // Paydirt's duration is what was billed. When it disagrees with end − start (a paused
      // timer or an edited duration), keep the start and Paydirt's duration; the end follows.
      seconds = span;
      if (secondsToHundredths(span) !== r.hundredths) {
        durationMismatch++;
        seconds = r.hundredths * 36;
      }
      if (seconds > 0) {
        startedAt = a.instant;
        endedAt = new Date(a.instant.getTime() + seconds * 1000);
        date = toLocalDate(a.instant, tz);
      }
    } else {
      seconds = Math.round((r.hundredths * 3600) / 100);
    }
    if (r.priceMinor !== lineAmount(r.hundredths, r.rateMinor)) {
      errors.push(`time log row ${r.row}: price ${money(r.priceMinor)} ≠ ${r.hundredths / 100} h × ${money(r.rateMinor)}`);
    }
    entries.push({
      csvRow: r.row,
      taskKey,
      date,
      startedAt,
      endedAt,
      durationSeconds: seconds,
      note: r.note,
      billable: r.rateMinor > 0,
      invoiceNumber: r.invoicedIn,
      off: null,
    });
  }
  const durationLine = durationMismatch
    ? `Durations          ${durationMismatch} entries were paused or edited in Paydirt (end − start ≠ duration): imported with their start and Paydirt's duration`
    : "";
  const rowOf = new Map(rows.map((r) => [r.row, r]));

  // ── Claims: CSV "Invoiced in" against the PDFs' time lines ──────────────────────────────
  const csvMax = rows.map((r) => r.startDate).sort().pop() ?? "";
  const claimedFromPdf: string[] = [];
  const pdfOnlyLines: string[] = [];
  const staleLines: string[] = [];
  const unlined: string[] = [];
  for (const e of entries) {
    if (!e.invoiceNumber) continue;
    const src = byNumber.get(e.invoiceNumber);
    if (!src) errors.push(`time log row ${e.csvRow} is billed on #${e.invoiceNumber}, which has no PDF`);
    else if (folderClient.get(src.folder) !== rowOf.get(e.csvRow)?.client) errors.push(`time log row ${e.csvRow} is billed on #${e.invoiceNumber}, an invoice of another client`);
  }
  // Names on a PDF are the names when it was sent; tasks were renamed since. So a dated line
  // takes its task from the entry it bills (same date and hours); the name is a fallback.
  const resolveTask = (client: string, title: string): string | null => {
    const parts = title.split(" – ");
    for (let i = 1; i < parts.length; i++) {
      const k = key(client, parts.slice(0, i).join(" – "), parts.slice(i).join(" – "));
      if (taskByKey.has(k)) return k;
    }
    const named = tasks.filter((t) => t.name === title && t.projectKey.startsWith(key(client, "")));
    return named.length === 1 ? named[0].key : null;
  };
  const csvDate = (e: EntryPlan) => rowOf.get(e.csvRow)?.startDate;
  const csvHours = (e: EntryPlan) => rowOf.get(e.csvRow)?.hundredths;
  const pick = (pool: EntryPlan[], date: string, qty: number, tk: string | null) =>
    (tk ? pool.find((e) => csvDate(e) === date && csvHours(e) === qty && e.taskKey === tk) : undefined) ??
    pool.find((e) => csvDate(e) === date && csvHours(e) === qty);
  const invoices: InvoicePlan[] = [];
  const payByNumber = new Map(payments.map((p) => [p.number, p]));
  for (const n of numbers) {
    const src = byNumber.get(n) as PdfSource;
    const inv = src.invoice;
    const client = folderClient.get(src.folder);
    if (!client) continue;
    const remaining = entries.filter((x) => x.invoiceNumber === n);
    const lines: LinePlan[] = inv.lines.map((l) => {
      let taskKey = resolveTask(client, l.title);
      if (l.date) {
        let e = pick(remaining, l.date, l.qtyHundredths, taskKey);
        if (e) remaining.splice(remaining.indexOf(e), 1);
        else {
          // The time log may still show it unbilled (exported before this invoice).
          e = pick(entries.filter((x) => !x.invoiceNumber && rowOf.get(x.csvRow)?.client === client), l.date, l.qtyHundredths, taskKey);
          if (e) {
            e.invoiceNumber = n;
            claimedFromPdf.push(`row ${e.csvRow} → #${n}`);
          } else if (l.date > csvMax) staleLines.push(`#${n}`);
          else pdfOnlyLines.push(`#${n}`);
        }
        if (e) taskKey = e.taskKey;
      }
      return {
        kind: taskKey ? "time" : "manual",
        taskKey,
        title: l.date ? formatTitleDate(l.date, l.title) : l.title,
        detail: l.detail,
        qtyHundredths: l.qtyHundredths,
        unit: taskKey ? "h" : "",
        rateMinor: l.rateMinor,
        amountMinor: l.amountMinor,
      };
    });
    if (inv.lines.some((l) => l.date) && remaining.length) unlined.push(`#${n} (${remaining.length})`);
    const pay = payByNumber.get(n);
    if (!pay) errors.push(`#${n} has no row in paydirt-payments.csv`);
    else if (pay.status === "paid" && pay.amountMinor !== inv.totalMinor) errors.push(`#${n}: paid ${money(pay.amountMinor ?? 0)} but the total is ${money(inv.totalMinor)}`);
    const c = clientByKey.get(client) as ClientPlan;
    invoices.push({
      number: n,
      seq: Number(n),
      clientKey: client,
      currency: inv.currency,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      termsDays: daysBetween(inv.issueDate, inv.dueDate),
      summary: inv.summary,
      from: inv.from,
      to: { name: inv.billedTo[0] ?? client, contactName: inv.billedTo[1] ?? "", address: inv.billedTo.slice(2).join("\n"), taxId: "", emails: c.billingEmails },
      account: inv.payment.length ? paymentSnapshot(inv.payment, inv.currency) : null,
      lines,
      totalMinor: inv.totalMinor,
      pdfPath: src.path,
      payment: pay?.status === "paid" ? { paidOn: pay.paidOn as string, amountMinor: inv.totalMinor, note: pay.note } : null,
    });
  }
  for (const p of payments) if (!byNumber.has(p.number)) errors.push(`paydirt-payments.csv has #${p.number}, which has no PDF`);
  if (staleLines.length) {
    const msg = `the time log ends on ${csvMax}, but ${staleLines.length} invoice lines are dated after it (${[...new Set(staleLines)].join(", ")}). Export the time log again`;
    (errors as string[]).push(msg);
  }

  // ── Unbilled: stale ones come off, current ones stay ────────────────────────────────────
  const su = ov.staleUnbilled;
  for (const e of entries) {
    if (e.invoiceNumber || !e.billable || e.date >= su.cutoff) continue;
    const client = rowOf.get(e.csvRow)?.client ?? "";
    const rule = su.byClient?.[client] ?? su.default;
    e.off = { kind: rule.kind, ref: rule.ref, note: rule.note ?? null };
  }

  // Unbilled time that stays follows today's rate (D1): flag where that changes the amount.
  const rateChanges = entries.filter((e) => !e.invoiceNumber && !e.off && e.billable && rateOf(e.taskKey) !== rowOf.get(e.csvRow)?.rateMinor);
  if (rateChanges.length) warnings.push(`${rateChanges.length} unbilled entries will bill at a different rate than Paydirt shows: rows ${rateChanges.map((e) => e.csvRow).join(", ")}`);

  // ── Workspace profile and the live payment account: from the newest invoice ─────────────
  const newest = byNumber.get(numbers[numbers.length - 1]) as PdfSource;
  const account = paymentSnapshot(newest.invoice.payment, newest.invoice.currency);
  if (!account.accountNumber && !account.iban) errors.push(`the newest invoice's payment block has no account number or IBAN`);

  // ── Report ───────────────────────────────────────────────────────────────────────────────
  const sumBy = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
  say("PAYDIRT IMPORT PLAN");
  say(`Time zone ${tz} · next number ${ov.nextNumber} · time log up to ${csvMax}`);
  say();
  say(`Clients   ${clients.length} (${clients.filter((c) => !c.archived).length} active: ${clients.filter((c) => !c.archived).map((c) => c.name).join(", ")})`);
  say(`Projects  ${projects.length} (${projects.filter((p) => p.completed).length} completed)`);
  say(`Tasks     ${tasks.length} (${tasks.filter((t) => t.doneOn).length} done, ${tasks.filter((t) => t.billingMode === "non_billable").length} non-billable)`);
  const hrs = sumBy(entries, (e) => e.durationSeconds) / 3600;
  say(`Entries   ${entries.length} · ${hrs.toFixed(2)} h · ${entries.filter((e) => !e.startedAt).length} duration-only · ${entries.filter((e) => !e.billable).length} non-billable`);
  say();
  for (const cur of [...new Set(invoices.map((i) => i.currency))]) {
    const xs = invoices.filter((i) => i.currency === cur);
    say(`Invoices ${cur}  ${xs.length} · total ${money(sumBy(xs, (i) => i.totalMinor), cur)} · paid ${money(sumBy(xs.filter((i) => i.payment), (i) => i.totalMinor), cur)}`);
  }
  const open = invoices.filter((i) => !i.payment);
  say(`Open      ${open.map((i) => `#${i.number} ${i.clientKey} ${money(i.totalMinor, i.currency)} due ${i.dueDate}${i.dueDate < input.today ? " (overdue)" : ""}`).join("\n          ")}`);
  const allLines = invoices.flatMap((i) => i.lines);
  say(`Lines     ${allLines.length} · ${allLines.filter((l) => l.kind === "time").length} time · ${allLines.filter((l) => l.kind === "manual").length} manual · ${invoices.filter((i) => !i.account).length} invoices without a payment block`);
  say(`Holes     ${holes.join(", ")}`);
  say();
  const billed = entries.filter((e) => e.invoiceNumber);
  say(`Billed entries     ${billed.length} on ${new Set(billed.map((e) => e.invoiceNumber)).size} invoices`);
  if (claimedFromPdf.length) say(`  claimed from PDF lines (the time log still shows them unbilled): ${claimedFromPdf.length} — ${claimedFromPdf.slice(0, 6).join(", ")}${claimedFromPdf.length > 6 ? ", …" : ""}`);
  if (pdfOnlyLines.length) say(`  PDF time lines with no entry (deleted or edited after billing): ${pdfOnlyLines.length} — ${[...new Set(pdfOnlyLines)].join(", ")}`);
  if (unlined.length) say(`  entries billed on an invoice with no matching dated line: ${unlined.join(", ")}`);
  if (durationLine) say(durationLine);
  const off = entries.filter((e) => e.off);
  const offValue = (xs: EntryPlan[]) => {
    const by = new Map<string, number>();
    for (const e of xs) {
      const r = rowOf.get(e.csvRow) as PaydirtTimeRow;
      const cur = clientByKey.get(r.client)?.currency ?? "USD";
      by.set(cur, (by.get(cur) ?? 0) + r.priceMinor);
    }
    return [...by].map(([c, v]) => money(v, c)).join(" + ");
  };
  say(`Written off        ${off.length} entries · ${offValue(off)} (before ${su.cutoff})`);
  const perClient = (xs: EntryPlan[]) =>
    [...new Set(xs.map((e) => rowOf.get(e.csvRow)?.client ?? ""))].map((c) => `${c} ${xs.filter((e) => rowOf.get(e.csvRow)?.client === c).length} (${offValue(xs.filter((e) => rowOf.get(e.csvRow)?.client === c))})`);
  for (const l of perClient(off)) say(`  ${l}`);
  const unbilled = entries.filter((e) => !e.invoiceNumber && !e.off && e.billable);
  say(`Unbilled (stays)   ${unbilled.length} entries · ${offValue(unbilled)}`);
  for (const l of perClient(unbilled)) say(`  ${l}`);
  say();
  say(`Workspace profile  ${newest.invoice.from.businessName} · ${newest.invoice.from.senderName}`);
  say(`Payment account    ${account.label} · ${account.currency} · SWIFT ${account.swiftBic ?? "–"} (from #${newest.invoice.number})`);

  return { timeZone: tz, nextNumber: ov.nextNumber, profile: newest.invoice.from, account, clients, projects, tasks, entries, invoices, errors, warnings, report };
}

/** "2026-10-03" + "pith.science – General…" → "Oct 3, 2026 – pith.science – General…", as printed. */
function formatTitleDate(date: string, rest: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${mon} ${d}, ${y} – ${rest}`;
}
