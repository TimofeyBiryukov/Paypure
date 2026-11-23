import { createHash, randomBytes } from "node:crypto";
import {
  addDays,
  type BillableEntry,
  type BuiltLine,
  buildTimeLines,
  DEFAULT_LAYOUT,
  type EditableLine,
  type FromSnapshot,
  fillTemplate,
  formatDateLong,
  formatInvoiceNumber,
  formatMoney,
  type LineLayout,
  lineAmount,
  numberPeriod,
  type PaymentAccountSnapshot,
  resolveRate,
  type SheetData,
  sheetFromLines,
  type ToSnapshot,
  todayIn,
} from "@paypure/domain";
import type { Ctx } from "../common/auth";
import { d2s, s2d } from "../common/dates";
import { conflict, invalid, notFound } from "../common/errors";
import { env } from "../env";
import type {
  Client,
  InvoiceLine,
  InvoiceVersion,
  InvoiceVersionTax,
  PaymentAccount,
  Workspace,
} from "../generated/prisma/client";
import { Prisma, type Tx } from "../prisma.service";

export const TEMPLATE_VERSION = "sheet-1";

// ── Snapshots (08 §3.2) ──────────────────────────────────────────────────────────────────

export function fromSnapshot(ws: Workspace): FromSnapshot {
  return {
    businessName: ws.businessName || ws.name,
    senderName: ws.senderName,
    address: ws.address,
    phone: ws.phone,
    taxId: ws.taxId,
    email: ws.billingEmail,
  };
}

export function toSnapshot(c: Client): ToSnapshot {
  return {
    name: c.name,
    contactName: c.contactName,
    address: c.address,
    taxId: c.taxId,
    emails: c.billingEmails,
  };
}

export function accountSnapshot(a: PaymentAccount): PaymentAccountSnapshot {
  return {
    label: a.label,
    currency: a.currency,
    beneficiaryName: a.beneficiaryName,
    beneficiaryAddress: a.beneficiaryAddress,
    bankName: a.bankName,
    bankAddress: a.bankAddress,
    accountNumber: a.accountNumber,
    iban: a.iban,
    swiftBic: a.swiftBic,
    routingNumber: a.routingNumber,
    correspondentBankName: a.correspondentBankName,
    correspondentAccount: a.correspondentAccount,
    correspondentSwift: a.correspondentSwift,
    referenceHint: a.referenceHint,
    instructions: a.instructions,
  };
}

/** Which account a draft gets, read live (07 §8.2). */
export async function resolveAccount(
  tx: Tx,
  ws: Workspace,
  client: Client,
  v: Pick<InvoiceVersion, "paymentAccountMode" | "paymentAccountId">,
  currency: string,
): Promise<PaymentAccount | null> {
  if (v.paymentAccountMode === "none") return null;
  if (v.paymentAccountMode === "account" && v.paymentAccountId) {
    return tx.paymentAccount.findUnique({ where: { id: v.paymentAccountId } });
  }
  if (client.defaultPaymentAccountId) {
    const a = await tx.paymentAccount.findUnique({ where: { id: client.defaultPaymentAccountId } });
    if (a && a.currency === currency && !a.archivedAt) return a;
  }
  return tx.paymentAccount.findFirst({
    where: { workspaceId: ws.id, currency, isDefault: true, archivedAt: null },
  });
}

type VersionFull = InvoiceVersion & {
  lines: (InvoiceLine & { taxes: { versionTaxId: string }[] })[];
  taxes: InvoiceVersionTax[];
};

export function editableLines(v: VersionFull): EditableLine[] {
  return v.lines
    .sort((a, b) => a.position - b.position)
    .map((l) => ({
      id: l.id,
      kind: l.kind,
      title: l.title,
      detail: l.detail,
      qtyHundredths: l.qtyHundredths,
      unit: l.unit,
      rateMinor: l.rateMinor,
      discountRateBp: l.discountRateBp,
      taxIds: l.taxes.map((t) => t.versionTaxId),
    }));
}

/** SheetData for any version: frozen versions read their snapshots, open ones read live. */
export async function buildSheet(
  tx: Tx,
  ws: Workspace,
  invoice: { number: string | null; currency: string; client: Client },
  v: VersionFull,
  opts: { watermark?: boolean } = {},
): Promise<SheetData> {
  const computed = sheetFromLines(
    editableLines(v),
    v.taxes
      .sort((a, b) => a.position - b.position)
      .map((t) => ({ id: t.id, name: t.name, rateBp: t.rateBp })),
  );
  let account: PaymentAccountSnapshot | null =
    v.paymentAccountSnapshot as unknown as PaymentAccountSnapshot | null;
  if (!v.frozenAt && !account) {
    const a = await resolveAccount(tx, ws, invoice.client, v, invoice.currency);
    account = a ? accountSnapshot(a) : null;
  }
  if (v.frozenAt && v.paymentAccountMode === "none") account = null;
  const frozenFirst = v.rev > 1 && v.frozenAt ? d2s(v.frozenAt) : null;
  return {
    number: opts.watermark ? null : invoice.number,
    rev: v.rev,
    revisedOn: v.rev > 1 ? (frozenFirst ?? null) : null,
    issueDate: d2s(v.issueDate),
    dueDate: d2s(v.dueDate),
    currency: invoice.currency,
    summary: v.summary,
    notes: v.notes,
    from: (v.fromSnapshot as unknown as FromSnapshot) ?? fromSnapshot(ws),
    to: (v.toSnapshot as unknown as ToSnapshot) ?? toSnapshot(invoice.client),
    paymentAccount: account,
    lines: computed.lines,
    taxes: computed.taxes,
    subtotalMinor: computed.subtotalMinor,
    totalMinor: computed.totalMinor,
    ...(opts.watermark ? { watermark: true } : {}),
  };
}

export const versionInclude = {
  lines: {
    include: { taxes: { select: { versionTaxId: true } } },
    orderBy: { position: "asc" as const },
  },
  taxes: { orderBy: { position: "asc" as const } },
} satisfies Prisma.InvoiceVersionInclude;

export async function writeTotals(tx: Tx, versionId: string) {
  const v = await tx.invoiceVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: versionInclude,
  });
  const s = sheetFromLines(
    editableLines(v),
    v.taxes.map((t) => ({ id: t.id, name: t.name, rateBp: t.rateBp })),
  );
  await tx.invoiceVersion.update({
    where: { id: versionId },
    data: {
      subtotal: s.subtotalMinor,
      discountTotal: s.lines
        .filter((l) => l.kind === "discount")
        .reduce((a, l) => a + l.amountMinor, 0),
      taxTotal: s.taxes.reduce((a, t) => a + t.amountMinor, 0),
      total: s.totalMinor,
    },
  });
  return s;
}

// ── Entries → lines ──────────────────────────────────────────────────────────────────────

export async function billableEntries(
  tx: Tx,
  ws: Workspace,
  entryIds: string[],
): Promise<(BillableEntry & { clientId: string; rateLabel: string })[]> {
  if (entryIds.length === 0) return [];
  const rows = await tx.timeEntry.findMany({
    where: { id: { in: entryIds }, workspaceId: ws.id },
    include: {
      task: {
        include: { project: { include: { client: true } } },
      },
    },
  });
  return rows.map((e) => {
    const t = e.task;
    if (!t) throw invalid("An entry has no task.");
    const c = t.project.client;
    const r = resolveRate({
      taskRateMinor: t.rateMinor,
      projectRateMinor: t.project.rateMinor,
      clientRateMinor: c.rateMinor,
      clientCurrency: c.currency,
      workspaceRateMinor: ws.defaultRateMinor,
      workspaceCurrency: ws.currency,
    });
    return {
      id: e.id,
      date: d2s(e.date) as string,
      seconds: e.durationSeconds,
      note: e.note,
      taskId: t.id,
      projectName: t.project.name,
      taskName: t.name,
      rateMinor: r?.rateMinor ?? null,
      clientId: c.id,
      rateLabel: c.name,
    };
  });
}

/** Insert built lines into a version, with all of the version's taxes, and link entries. */
export async function insertLines(
  tx: Tx,
  versionId: string,
  lines: BuiltLine[],
  taxIds: string[],
  startPos = 0,
) {
  let pos = startPos;
  for (const l of lines) {
    const line = await tx.invoiceLine.create({
      data: {
        versionId,
        position: pos++,
        kind: l.kind,
        title: l.title,
        detail: l.detail,
        qtyHundredths: l.qtyHundredths,
        unit: l.unit,
        rateMinor: l.rateMinor,
        amountMinor: lineAmount(l.qtyHundredths, l.rateMinor),
        taskId: l.taskId,
        sourceFingerprint: l.sourceFingerprint,
      },
    });
    if (taxIds.length) {
      await tx.invoiceLineTax.createMany({
        data: taxIds.map((t) => ({ lineId: line.id, versionTaxId: t })),
      });
    }
    if (l.entryIds.length) {
      await tx.invoiceLineEntry.createMany({
        data: l.entryIds.map((id) => ({
          lineId: line.id,
          timeEntryId: id,
          seconds: l.entrySeconds[id] ?? 0,
        })),
      });
    }
  }
  return pos;
}

/**
 * Claim entries for an invoice: they must be unbilled hourly time of this client. The claim is
 * an UPDATE … WHERE invoice_id IS NULL, so two drafts can never claim the same entry (S9).
 */
export async function claimEntries(
  tx: Tx,
  ws: Workspace,
  clientId: string,
  invoiceId: string,
  entryIds: string[],
) {
  if (entryIds.length === 0) return;
  const r = await tx.timeEntry.updateMany({
    where: {
      id: { in: entryIds },
      workspaceId: ws.id,
      invoiceId: null,
      offInvoice: null,
      billable: true,
      state: "stopped",
      deletedAt: null,
      task: { billingMode: "hourly", project: { clientId } },
    },
    data: { invoiceId },
  });
  if (r.count !== entryIds.length) {
    throw conflict(
      "entries_unavailable",
      "Some entries were billed, changed or deleted meanwhile. Reload and try again.",
    );
  }
}

// ── Corrections (08 §4.2) ────────────────────────────────────────────────────────────────

export async function openCorrectionTx(tx: Tx, ctx: Ctx, invoiceId: string) {
  const inv = await tx.invoice.findFirst({
    where: { id: invoiceId, workspaceId: ctx.workspace.id },
    include: {
      currentVersion: {
        include: { ...versionInclude, lines: { include: { taxes: true, entries: true } } },
      },
    },
  });
  if (!inv) throw notFound("Invoice not found");
  if (inv.status !== "issued") throw conflict("not_issued", "Only sent invoices are corrected.");
  if (inv.source === "paydirt")
    throw conflict("imported", "Imported invoices can't be corrected. Duplicate it instead.");
  const open = await tx.invoiceVersion.findFirst({ where: { invoiceId, frozenAt: null } });
  if (open) return open;
  const cur = inv.currentVersion;
  if (!cur) throw conflict("no_version", "This invoice has no sent version.");
  const v = await tx.invoiceVersion.create({
    data: {
      invoiceId,
      rev: cur.rev + 1,
      issueDate: cur.issueDate,
      dueDate: cur.dueDate,
      dueDateManual: true,
      termsDays: cur.termsDays,
      summary: cur.summary,
      notes: cur.notes,
      // carried over pinned: a typo fix never switches the address or bank details
      fromSnapshot: cur.fromSnapshot ?? Prisma.DbNull,
      toSnapshot: cur.toSnapshot ?? Prisma.DbNull,
      paymentAccountMode: cur.paymentAccountMode,
      paymentAccountId: cur.paymentAccountId,
      paymentAccountSnapshot: cur.paymentAccountSnapshot ?? Prisma.DbNull,
      lineLayout: cur.lineLayout as Prisma.InputJsonValue,
      subtotal: cur.subtotal,
      discountTotal: cur.discountTotal,
      taxTotal: cur.taxTotal,
      total: cur.total,
    },
  });
  const taxMap = new Map<string, string>();
  for (const t of cur.taxes) {
    const nt = await tx.invoiceVersionTax.create({
      data: { versionId: v.id, name: t.name, rateBp: t.rateBp, position: t.position },
    });
    taxMap.set(t.id, nt.id);
  }
  for (const l of cur.lines) {
    const nl = await tx.invoiceLine.create({
      data: {
        versionId: v.id,
        position: l.position,
        kind: l.kind,
        title: l.title,
        detail: l.detail,
        qtyHundredths: l.qtyHundredths,
        unit: l.unit,
        rateMinor: l.rateMinor,
        amountMinor: l.amountMinor,
        discountRateBp: l.discountRateBp,
        taskId: l.taskId,
        overrides: l.overrides as Prisma.InputJsonValue,
        sourceFingerprint: l.sourceFingerprint,
      },
    });
    if (l.taxes.length) {
      await tx.invoiceLineTax.createMany({
        data: l.taxes.map((t) => ({
          lineId: nl.id,
          versionTaxId: taxMap.get(t.versionTaxId) as string,
        })),
      });
    }
    if (l.entries.length) {
      await tx.invoiceLineEntry.createMany({
        data: l.entries.map((e) => ({
          lineId: nl.id,
          timeEntryId: e.timeEntryId,
          seconds: e.seconds,
        })),
      });
    }
  }
  await tx.invoiceActivity.create({
    data: {
      invoiceId,
      versionId: v.id,
      kind: "correction_opened",
      actor: "member",
      actorId: ctx.member.id,
      data: { rev: v.rev },
    },
  });
  return v;
}

/**
 * Apply staged entry changes (08 §5.2) inside the freeze transaction. The guard trigger lets
 * them through because paypure.applying_version is set for this transaction only.
 */
export async function applyStagedChanges(
  tx: Tx,
  ws: Workspace,
  versionId: string,
  layout: LineLayout,
) {
  const changes = await tx.invoiceEntryChange.findMany({ where: { versionId } });
  if (changes.length === 0) return;
  await tx.$executeRaw`SELECT set_config('paypure.applying_version', ${versionId}, true)`;
  for (const ch of changes) {
    const c = ch.changes as Record<string, [unknown, unknown]>;
    const val = <T>(k: string): T | undefined => (k in c ? (c[k][1] as T) : undefined);
    const segs = ch.segments as { startedAt: string; endedAt: string }[] | null;
    if (segs) {
      await tx.timeEntrySegment.deleteMany({ where: { timeEntryId: ch.timeEntryId } });
      await tx.timeEntrySegment.createMany({
        data: segs.map((s) => ({
          workspaceId: ws.id,
          timeEntryId: ch.timeEntryId,
          startedAt: new Date(s.startedAt),
          endedAt: new Date(s.endedAt),
        })),
      });
    }
    const data: Prisma.TimeEntryUncheckedUpdateInput = { version: { increment: 1 } };
    if (val<string>("taskId") !== undefined) data.taskId = val<string>("taskId");
    if (val<string>("date") !== undefined) data.date = s2d(val<string>("date") as string);
    if (val<string | null>("startedAt") !== undefined)
      data.startedAt = val<string | null>("startedAt");
    if (val<string | null>("endedAt") !== undefined) data.endedAt = val<string | null>("endedAt");
    if (val<number>("durationSeconds") !== undefined)
      data.durationSeconds = val<number>("durationSeconds");
    if (val<string>("note") !== undefined) data.note = val<string>("note");
    if (val<boolean>("billable") !== undefined) data.billable = val<boolean>("billable");
    if (ch.op === "delete") data.deletedAt = new Date();
    await tx.timeEntry.update({ where: { id: ch.timeEntryId }, data });
  }
  // Entries that moved to another client, became non-billable or were deleted leave the invoice.
  const inv = await tx.invoiceVersion.findUniqueOrThrow({
    where: { id: versionId },
    select: { invoice: { select: { id: true, clientId: true } } },
  });
  const affected = await tx.timeEntry.findMany({
    where: { id: { in: changes.map((c) => c.timeEntryId) } },
    include: { task: { include: { project: true } } },
  });
  const leaving = affected
    .filter((e) => e.deletedAt || !e.billable || e.task?.project.clientId !== inv.invoice.clientId)
    .map((e) => e.id);
  if (leaving.length) {
    await tx.invoiceLineEntry.deleteMany({
      where: { timeEntryId: { in: leaving }, line: { versionId } },
    });
  }
  await regenerateLines(tx, ws, versionId, layout, { onlyEntryIds: affected.map((e) => e.id) });
  await tx.$executeRaw`SELECT set_config('paypure.applying_version', '', true)`;
}

/**
 * Regenerate time lines from their entries (Update, 08 §5.2). Keeps fields edited by hand
 * (`overrides`) and refreshes rates. Lines with no entries left are removed.
 */
export async function regenerateLines(
  tx: Tx,
  ws: Workspace,
  versionId: string,
  layout: LineLayout,
  opts: { onlyEntryIds?: string[]; onlyLineIds?: string[] } = {},
) {
  const v = await tx.invoiceVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: { lines: { include: { entries: true, taxes: true }, orderBy: { position: "asc" } } },
  });
  for (const line of v.lines) {
    if (line.kind !== "time") continue;
    if (opts.onlyLineIds && !opts.onlyLineIds.includes(line.id)) continue;
    const ids = line.entries.map((e) => e.timeEntryId);
    if (opts.onlyEntryIds && !ids.some((id) => opts.onlyEntryIds?.includes(id))) {
      if (line.entries.length > 0) continue;
    }
    if (ids.length === 0) {
      await tx.invoiceLine.delete({ where: { id: line.id } });
      continue;
    }
    const entries = (await billableEntries(tx, ws, ids)).filter((e) => !!e);
    const built = buildTimeLines(entries, {
      ...layout,
      mode: layout.mode === "per_entry" && ids.length > 1 ? "per_task" : layout.mode,
    });
    const b = built[0];
    const overrides = new Set((line.overrides as string[]) ?? []);
    const qty = overrides.has("qtyHundredths") ? line.qtyHundredths : b.qtyHundredths;
    const rate = overrides.has("rateMinor") ? line.rateMinor : (b.rateMinor ?? 0);
    await tx.invoiceLine.update({
      where: { id: line.id },
      data: {
        title: overrides.has("title") ? line.title : b.title,
        detail: overrides.has("detail") ? line.detail : b.detail,
        qtyHundredths: qty,
        rateMinor: rate,
        amountMinor: lineAmount(qty, rate),
        taskId: b.taskId,
        sourceFingerprint: b.sourceFingerprint,
      },
    });
    for (const le of line.entries) {
      const sec = b.entrySeconds[le.timeEntryId];
      if (sec !== undefined && sec !== le.seconds) {
        await tx.invoiceLineEntry.update({
          where: { lineId_timeEntryId: { lineId: line.id, timeEntryId: le.timeEntryId } },
          data: { seconds: sec },
        });
      }
    }
  }
}

/** Lines whose entries or rates changed since they were made (08 §5.2 "N lines out of date"). */
export async function outdatedLineIds(
  tx: Tx,
  ws: Workspace,
  versionId: string,
  layout: LineLayout,
): Promise<string[]> {
  const v = await tx.invoiceVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: { lines: { include: { entries: true } } },
  });
  const out: string[] = [];
  for (const line of v.lines) {
    if (line.kind !== "time") continue;
    const ids = line.entries.map((e) => e.timeEntryId);
    if (ids.length === 0) {
      out.push(line.id);
      continue;
    }
    const entries = await billableEntries(tx, ws, ids);
    const alive = await tx.timeEntry.count({ where: { id: { in: ids }, deletedAt: null } });
    const built = buildTimeLines(entries, {
      ...layout,
      mode: layout.mode === "per_entry" && ids.length > 1 ? "per_task" : layout.mode,
    });
    if (alive !== ids.length || built[0]?.sourceFingerprint !== line.sourceFingerprint)
      out.push(line.id);
  }
  return out;
}

// ── Numbering + freezing (08 §6, §3.2, §7.2) ─────────────────────────────────────────────

export async function assignNumber(tx: Tx, ws: Workspace, _invoiceId: string, issueDate: string) {
  const period = numberPeriod(ws.numberReset, issueDate);
  const latest = await tx.$queryRaw<{ d: Date | null }[]>`
    SELECT MAX(v.issue_date) AS d FROM invoices i JOIN invoice_versions v ON v.id = i.current_version_id
    WHERE i.workspace_id = ${ws.id}::uuid AND i.number_period = ${period} AND i.status <> 'draft'`;
  const latestDate = d2s(latest[0]?.d ?? null);
  if (latestDate && issueDate < latestDate) {
    throw invalid(
      `The issue date can't be before the last issued invoice (${formatDateLong(latestDate)}).`,
      {
        fields: { issueDate: "Before the last issued invoice" },
      },
    );
  }
  const maxUsed = await tx.invoice.aggregate({
    where: { workspaceId: ws.id, numberPeriod: period },
    _max: { numberSeq: true },
  });
  await tx.$executeRaw`
    INSERT INTO invoice_sequences (workspace_id, period, next_seq)
    VALUES (${ws.id}::uuid, ${period}, ${(maxUsed._max.numberSeq ?? 0) + 1})
    ON CONFLICT DO NOTHING`;
  const rows = await tx.$queryRaw<{ seq: number }[]>`
    UPDATE invoice_sequences SET next_seq = next_seq + 1
    WHERE workspace_id = ${ws.id}::uuid AND period = ${period}
    RETURNING next_seq - 1 AS seq`;
  const seq = rows[0].seq;
  return { number: formatInvoiceNumber(ws.numberFormat, seq, issueDate), seq, period };
}

export function contentHash(sheet: SheetData): string {
  const canonical = JSON.stringify(sheet, Object.keys(sheet).sort());
  return createHash("sha256")
    .update(canonical + JSON.stringify(sheet.lines))
    .digest("hex");
}

export async function freezeVersion(
  tx: Tx,
  ctx: Ctx,
  invoiceId: string,
  versionId: string,
  extra: Partial<InvoiceVersion> = {},
) {
  const ws = ctx.workspace;
  const inv = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { client: true },
  });
  const v = await tx.invoiceVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: versionInclude,
  });
  const account = v.paymentAccountSnapshot
    ? null
    : await resolveAccount(tx, ws, inv.client, v, inv.currency);
  await tx.invoiceVersion.update({
    where: { id: versionId },
    data: {
      ...(extra as Prisma.InvoiceVersionUncheckedUpdateInput),
      fromSnapshot: (v.fromSnapshot ?? fromSnapshot(ws)) as Prisma.InputJsonValue,
      toSnapshot: (v.toSnapshot ?? toSnapshot(inv.client)) as Prisma.InputJsonValue,
      paymentAccountId: v.paymentAccountSnapshot ? v.paymentAccountId : (account?.id ?? null),
      paymentAccountSnapshot: v.paymentAccountSnapshot
        ? (v.paymentAccountSnapshot as Prisma.InputJsonValue)
        : account && v.paymentAccountMode !== "none"
          ? (accountSnapshot(account) as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
    },
  });
  await writeTotals(tx, versionId);
  const fresh = await tx.invoiceVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: versionInclude,
  });
  const sheet = await buildSheet(tx, ws, { ...inv, client: inv.client }, fresh);
  await tx.invoiceVersion.update({
    where: { id: versionId },
    data: {
      contentHash: contentHash(sheet),
      templateVersion: TEMPLATE_VERSION,
      frozenAt: new Date(),
      frozenBy: ctx.member.id,
    },
  });
  return sheet;
}

// ── Email (08 §7) ────────────────────────────────────────────────────────────────────────

export const DEFAULT_TEMPLATES: Record<
  "invoice" | "correction" | "reminder" | "thank_you",
  { subject: string; body: string }
> = {
  invoice: {
    subject: "Invoice {{number}} from {{business_name}}",
    body: "Hi {{client_name}},\n\nPlease find invoice {{number}} for {{total}} attached, due on {{due_date}}.\n\nYou can view it online: {{link}}\n\nThank you,\n{{sender_name}}",
  },
  correction: {
    subject: "Invoice {{number}} has been updated",
    body: "Hi {{client_name}},\n\nInvoice {{number}} has been updated (revision {{rev}}). This version replaces the earlier one.\n\nWhat changed: {{changes_summary}}\n\nNew total: {{total}}. Balance: {{balance}}.\n\nView it online: {{link}}\n\n{{sender_name}}",
  },
  reminder: {
    subject: "Reminder: invoice {{number}} is due",
    body: "Hi {{client_name}},\n\nA friendly reminder that invoice {{number}} was due on {{due_date}} ({{days_overdue}} days ago). The balance is {{balance}}.\n\nView it online: {{link}}\n\nThank you,\n{{sender_name}}",
  },
  thank_you: {
    subject: "Payment received for invoice {{number}}",
    body: "Hi {{client_name}},\n\nThank you. We received {{paid}} for invoice {{number}}. The balance is now {{balance}}.\n\n{{sender_name}}",
  },
};

export function publicLink(token: string) {
  return `${env.PUBLIC_URL}/i/${token}`;
}

export function newPublicToken() {
  return randomBytes(16).toString("base64url");
}

export function emailVars(input: {
  ws: Workspace;
  client: Client;
  number: string | null;
  rev: number;
  currency: string;
  totalMinor: number;
  netPaidMinor: number;
  dueDate: string | null;
  token: string;
  changesSummary?: string | null;
  paidMinor?: number;
}): Record<string, string | undefined> {
  const today = todayIn(input.ws.timeZone);
  const overdue =
    input.dueDate && input.dueDate < today
      ? Math.round((Date.parse(today) - Date.parse(input.dueDate)) / 86400000)
      : 0;
  const m = (minor: number) => formatMoney({ minor, currency: input.currency }, { withCode: true });
  return {
    number: input.number ?? "(assigned on send)",
    rev: String(input.rev),
    business_name: input.ws.businessName || input.ws.name,
    sender_name: input.ws.senderName || input.ws.businessName || input.ws.name,
    client_name: input.client.contactName || input.client.name,
    total: m(input.totalMinor),
    balance: m(input.totalMinor - input.netPaidMinor),
    paid: m(input.paidMinor ?? input.netPaidMinor),
    due_date: input.dueDate ? formatDateLong(input.dueDate) : undefined,
    days_overdue: String(overdue),
    link: publicLink(input.token),
    changes_summary: input.changesSummary ?? undefined,
  };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderEmailHtml(text: string) {
  const paras = text.split(/\n{2,}/).map(
    (p) =>
      `<p>${escapeHtml(p)
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
        .replace(/\n/g, "<br>")}</p>`,
  );
  return `<!doctype html><html><body style="font-family:Inter,system-ui,sans-serif;font-size:14px;line-height:20px;color:#1B1A18">${paras.join("")}</body></html>`;
}

export async function queueEmail(
  tx: Tx,
  ctx: Ctx,
  input: {
    invoiceId: string | null;
    versionId: string | null;
    kind: "invoice" | "correction" | "reminder" | "thank_you" | "test";
    idempotencyKey: string;
    to: string[];
    cc: string[];
    subject: string;
    text: string;
  },
) {
  const ws = ctx.workspace;
  const from = `${ws.senderName || ws.businessName || ws.name} <invoices@paypure.local>`;
  return tx.outboundEmail.create({
    data: {
      workspaceId: ws.id,
      invoiceId: input.invoiceId,
      versionId: input.versionId,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      from,
      replyTo: ws.billingEmail,
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      textBody: input.text,
      htmlBody: renderEmailHtml(input.text),
      createdBy: ctx.member.id,
    },
  });
}

export { addDays, DEFAULT_LAYOUT, fillTemplate };
