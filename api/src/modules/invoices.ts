import { randomUUID } from "node:crypto";
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import {
  addDays,
  ApproveCorrectionInput,
  buildFixedLine,
  buildTimeLines,
  CreateDraftInput,
  DEFAULT_LAYOUT,
  DraftUpdateInput,
  displayStatus,
  fillTemplate,
  type LineLayout,
  lineAmount,
  MarkSentInput,
  PaymentInput,
  percentOf,
  resolveRate,
  SendInput,
  todayIn,
  unbilledFixed,
  VoidInput,
} from "@paypure/domain";
import type { FastifyReply } from "fastify";
import { AdminOnly, C, type Ctx } from "../common/auth";
import { d2s, s2d } from "../common/dates";
import { ApiError, conflict, invalid, notFound } from "../common/errors";
import { parse } from "../common/zod";
import { env } from "../env";
import { Prisma, PrismaService, type Tx } from "../prisma.service";
import { BillingService } from "./billing";
import { EventsService } from "./events";
import {
  applyStagedChanges,
  assignNumber,
  billableEntries,
  buildSheet,
  claimEntries,
  DEFAULT_TEMPLATES,
  editableLines,
  emailVars,
  freezeVersion,
  insertLines,
  newPublicToken,
  openCorrectionTx,
  outdatedLineIds,
  publicLink,
  queueEmail,
  regenerateLines,
  resolveAccount,
  versionInclude,
  withoutLinkLines,
  writeTotals,
} from "./invoice-ops";
import { PdfService } from "./pdf";

type EmailKind = "invoice" | "correction" | "reminder" | "thank_you";

@AdminOnly()
@Controller("v1/invoices")
export class InvoicesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly events: EventsService,
    private readonly pdf: PdfService,
  ) {}

  private emit(tx: Tx, ctx: Ctx, action: string, id: string) {
    return this.events.emit(tx, { ws: ctx.workspace.id, topic: "invoice", action, entity: id });
  }

  private async lockInvoice(tx: Tx, ctx: Ctx, id: string) {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
    const inv = await tx.invoice.findFirst({ where: { id, workspaceId: ctx.workspace.id }, include: { client: true } });
    if (!inv) throw notFound("Invoice not found");
    return inv;
  }

  private async netPaid(tx: Tx | PrismaService, invoiceId: string) {
    const ps = await tx.payment.findMany({ where: { invoiceId, deletedAt: null } });
    return ps.reduce((s, p) => s + (p.kind === "payment" ? p.amount : -p.amount), 0);
  }

  // ── List (S10) ───────────────────────────────────────────────────────────────────────────

  @Get()
  async list(@C() ctx: Ctx, @Query("tab") tab = "all", @Query("client") client?: string, @Query("void") showVoid?: string) {
    const all = await this.billing.invoiceSummaries(ctx.workspace, client ? { clientId: client } : {});
    const visible = all.filter((i) => showVoid === "1" || i.status !== "void");
    const by = (k: string) =>
      visible.filter((i) =>
        k === "drafts"
          ? i.status === "draft"
          : k === "outstanding"
            ? i.status === "issued" && i.balanceMinor > 0
            : k === "overdue"
              ? i.display.key === "overdue"
              : k === "paid"
                ? i.display.key === "paid"
                : k === "void"
                  ? i.status === "void"
                  : true,
      );
    const counts = Object.fromEntries(
      ["all", "drafts", "outstanding", "overdue", "paid"].map((k) => [k, by(k).length]),
    );
    const month = todayIn(ctx.workspace.timeZone).slice(0, 7);
    const issued = all.filter((i) => i.status === "issued");
    const group = (xs: typeof all, pick: (i: (typeof all)[number]) => number) => {
      const m = new Map<string, number>();
      for (const i of xs) m.set(i.currency, (m.get(i.currency) ?? 0) + pick(i));
      return [...m.entries()].map(([currency, minor]) => ({ currency, minor }));
    };
    return {
      invoices: tab === "void" ? all.filter((i) => i.status === "void") : by(tab),
      counts,
      stats: {
        outstanding: group(issued.filter((i) => i.balanceMinor > 0), (i) => i.balanceMinor),
        overdue: group(issued.filter((i) => i.display.key === "overdue"), (i) => i.balanceMinor),
        paidThisMonth: group(issued.filter((i) => i.lastPaidOn?.startsWith(month)), (i) => i.netPaidMinor),
      },
    };
  }

  // ── Builder (S9) ─────────────────────────────────────────────────────────────────────────

  @Get("builder")
  async builder(@C() ctx: Ctx, @Query("client") clientId: string, @Query("project") projectId?: string) {
    const ws = ctx.workspace;
    const client = await this.prisma.client.findFirst({ where: { id: clientId, workspaceId: ws.id } });
    if (!client) throw notFound("Client not found");
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        workspaceId: ws.id,
        state: "stopped",
        deletedAt: null,
        offInvoice: null,
        billable: true,
        task: { billingMode: "hourly", project: { clientId, ...(projectId ? { id: projectId } : {}) } },
        OR: [{ invoiceId: null }, { invoice: { status: "draft" } }],
      },
      include: {
        task: { include: { project: true } },
        member: { select: { name: true } },
        invoice: { select: { id: true, client: { select: { name: true } }, createdAt: true } },
      },
      orderBy: [{ date: "asc" }, { startedAt: "asc" }],
    });
    const tasks = await this.billing.unbilledTasks(ws, { clientId, projectId, includeArchived: true });
    const fixedTasks = tasks.filter((t) => t.mode === "fixed" && t.fixedRemainingMinor > 0);
    const trackedOnFixed = await this.prisma.timeEntry.groupBy({
      by: ["taskId"],
      where: { taskId: { in: fixedTasks.map((t) => t.taskId) }, deletedAt: null },
      _sum: { durationSeconds: true },
    });
    const live = await this.prisma.timeEntry.findMany({
      where: { workspaceId: ws.id, state: { not: "stopped" }, deletedAt: null, task: { project: { clientId } } },
      select: { id: true, member: { select: { name: true } }, startedAt: true },
      orderBy: { createdAt: "asc" },
    });
    const taxes = await this.prisma.workspaceDefaultTax.findMany({ where: { workspaceId: ws.id }, orderBy: { position: "asc" } });
    const v = { paymentAccountMode: "default" as const, paymentAccountId: null };
    const account = await resolveAccount(this.prisma as unknown as Tx, ws, client, v, client.currency);
    return {
      client: {
        id: client.id,
        name: client.name,
        colour: client.colour,
        currency: client.currency,
        termsDays: client.termsDays ?? ws.defaultTermsDays,
        lineLayout: (client.lineLayout as unknown as LineLayout) ?? DEFAULT_LAYOUT,
      },
      entries: entries.map((e) => {
        const t = e.task!;
        const r = resolveRate({
          taskRateMinor: t.rateMinor,
          projectRateMinor: t.project.rateMinor,
          clientRateMinor: client.rateMinor,
          clientCurrency: client.currency,
          workspaceRateMinor: ws.defaultRateMinor,
          workspaceCurrency: ws.currency,
        });
        return {
          id: e.id,
          date: d2s(e.date) as string,
          seconds: e.durationSeconds,
          note: e.note,
          taskId: t.id,
          taskName: t.name,
          projectId: t.project.id,
          projectName: t.project.name,
          rateMinor: r?.rateMinor ?? null,
          rateSource: r?.source ?? null,
          member: e.member.name,
          onDraft: e.invoice ? { id: e.invoice.id, label: `On draft for ${e.invoice.client.name}` } : null,
        };
      }),
      fixed: fixedTasks.map((t) => ({
        taskId: t.taskId,
        taskName: t.taskName,
        projectName: t.projectName,
        feeMinor: t.feeMinor,
        remainingMinor: t.fixedRemainingMinor,
        trackedSeconds: trackedOnFixed.find((x) => x.taskId === t.taskId)?._sum.durationSeconds ?? 0,
      })),
      liveTimers: live.map((l) => ({ member: l.member.name, startedAt: l.startedAt?.toISOString() ?? null })),
      taxes: taxes.map((t) => ({ id: t.id, name: t.name, rateBp: t.rateBp })),
      from: { businessName: ws.businessName || ws.name, senderName: ws.senderName, address: ws.address, phone: ws.phone, taxId: ws.taxId, email: ws.billingEmail },
      to: { name: client.name, contactName: client.contactName, address: client.address, taxId: client.taxId, emails: client.billingEmails },
      paymentAccount: account ? { label: account.label } : null,
    };
  }

  @Post("drafts")
  async createDraft(@C() ctx: Ctx, @Body() body: unknown) {
    const input = parse(CreateDraftInput, body);
    const ws = ctx.workspace;
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: input.clientId, workspaceId: ws.id } });
      if (!client) throw notFound("Client not found");
      const entries = await billableEntries(tx, ws, input.entryIds);
      const noRate = entries.filter((e) => e.rateMinor == null);
      if (noRate.length) {
        const hours = (noRate.reduce((s, e) => s + e.seconds, 0) / 3600).toFixed(1);
        throw invalid(`Set a rate for ${client.name} to bill ${hours}h.`, { code: "no_rate" });
      }
      const fixedBilled = await this.billing.fixedBilled(tx, ws.id);
      const fixedLines = [];
      for (const f of input.fixed) {
        const task = await tx.task.findFirst({ where: { id: f.taskId, workspaceId: ws.id, billingMode: "fixed", project: { clientId: client.id } }, include: { project: true } });
        if (!task?.fixedAmountMinor) throw invalid("That fixed-fee task isn't available.");
        const remaining = unbilledFixed(task.fixedAmountMinor, fixedBilled.get(task.id) ?? 0);
        if (f.amountMinor > remaining) throw invalid(`Bill at most the remaining fee for ${task.name}. To bill more, raise the task's fee first.`);
        fixedLines.push(
          buildFixedLine({ taskId: task.id, projectName: task.project.name, taskName: task.name, currency: client.currency, feeMinor: task.fixedAmountMinor, remainingMinor: remaining, amountMinor: f.amountMinor }),
        );
      }
      const invoice = await tx.invoice.create({
        data: { workspaceId: ws.id, clientId: client.id, currency: client.currency, publicToken: newPublicToken() },
      });
      const terms = client.termsDays ?? ws.defaultTermsDays;
      const version = await tx.invoiceVersion.create({
        data: {
          invoiceId: invoice.id,
          rev: 1,
          termsDays: terms,
          summary: input.summary ?? "",
          notes: ws.defaultNotes,
          lineLayout: input.layout as unknown as Prisma.InputJsonValue,
        },
      });
      const defaults = await tx.workspaceDefaultTax.findMany({ where: { workspaceId: ws.id }, orderBy: { position: "asc" } });
      const taxIds: string[] = [];
      for (const t of defaults) {
        const vt = await tx.invoiceVersionTax.create({ data: { versionId: version.id, name: t.name, rateBp: t.rateBp, position: t.position } });
        taxIds.push(vt.id);
      }
      await claimEntries(tx, ws, client.id, invoice.id, input.entryIds);
      const timeLines = buildTimeLines(entries, input.layout);
      const pos = await insertLines(tx, version.id, timeLines, taxIds);
      await insertLines(tx, version.id, fixedLines, taxIds, pos);
      await writeTotals(tx, version.id);
      // Line options are remembered per client (S9).
      await tx.client.update({ where: { id: client.id }, data: { lineLayout: input.layout as unknown as Prisma.InputJsonValue } });
      await this.emit(tx, ctx, "draft_created", invoice.id);
      await this.events.emit(tx, { ws: ws.id, member: ctx.member.id, topic: "time", action: "claimed" });
      return { id: invoice.id };
    });
  }

  // ── One invoice (S11) ────────────────────────────────────────────────────────────────────

  @Get(":id")
  async get(@C() ctx: Ctx, @Param("id") id: string) {
    const ws = ctx.workspace;
    return this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { id, workspaceId: ws.id },
        include: {
          client: true,
          versions: { include: versionInclude, orderBy: { rev: "asc" } },
          payments: { orderBy: { receivedOn: "asc" } },
          activity: { orderBy: { at: "desc" } },
          emails: { orderBy: { queuedAt: "desc" } },
        },
      });
      if (!inv) throw notFound("Invoice not found");
      const open = inv.versions.find((v) => !v.frozenAt) ?? null;
      const current = inv.versions.find((v) => v.id === inv.currentVersionId) ?? null;
      const netPaidMinor = inv.payments.filter((p) => !p.deletedAt).reduce((s, p) => s + (p.kind === "payment" ? p.amount : -p.amount), 0);
      const shown = current ?? open;
      const today = todayIn(ws.timeZone);
      const totalMinor = (inv.status === "draft" ? open?.total : current?.total) ?? 0;
      const status = displayStatus({ status: inv.status, totalMinor, netPaidMinor, dueDate: d2s(shown?.dueDate), today });
      const layout = ((open ?? current)?.lineLayout as unknown as LineLayout) ?? DEFAULT_LAYOUT;
      const outdated = open ? await outdatedLineIds(tx, ws, open.id, layout) : [];
      const lineEntryCounts = open
        ? await tx.invoiceLineEntry.groupBy({ by: ["lineId"], where: { line: { versionId: open.id } }, _count: { _all: true } })
        : [];
      const staged = open
        ? await tx.invoiceEntryChange.findMany({
            where: { versionId: open.id },
            include: { timeEntry: { select: { id: true, date: true, note: true, durationSeconds: true, task: { select: { name: true } } } } },
          })
        : [];
      const accounts = await tx.paymentAccount.findMany({
        where: { workspaceId: ws.id, currency: inv.currency, archivedAt: null },
        orderBy: [{ isDefault: "desc" }, { label: "asc" }],
      });
      const claimed = await tx.timeEntry.count({ where: { invoiceId: id } });
      return {
        id: inv.id,
        number: inv.number,
        status: inv.status,
        source: inv.source,
        currency: inv.currency,
        publicUrl: publicLink(inv.publicToken),
        client: { id: inv.client.id, name: inv.client.name, colour: inv.client.colour, billingEmails: inv.client.billingEmails },
        display: status,
        totalMinor,
        netPaidMinor,
        claimedEntries: claimed,
        currentVersion: current ? { id: current.id, rev: current.rev, sheet: await buildSheet(tx, ws, inv, current), changeSummary: current.changeSummary } : null,
        open: open
          ? {
              id: open.id,
              rev: open.rev,
              isCorrection: inv.status === "issued",
              issueDate: d2s(open.issueDate),
              dueDate: d2s(open.dueDate),
              dueDateManual: open.dueDateManual,
              termsDays: open.termsDays,
              summary: open.summary,
              notes: open.notes,
              layout,
              paymentAccountMode: open.paymentAccountMode,
              paymentAccountId: open.paymentAccountId,
              lines: editableLines(open).map((l) => ({
                ...l,
                entryCount: lineEntryCounts.find((c) => c.lineId === l.id)?._count._all ?? 0,
                outdated: outdated.includes(l.id as string),
              })),
              taxes: open.taxes.map((t) => ({ id: t.id, name: t.name, rateBp: t.rateBp })),
              sheet: await buildSheet(tx, ws, inv, open),
              staged: staged.map((s) => ({
                entryId: s.timeEntryId,
                op: s.op,
                changes: s.changes,
                taskName: s.timeEntry.task?.name ?? "",
                date: d2s(s.timeEntry.date),
              })),
            }
          : null,
        versions: inv.versions
          .filter((v) => v.frozenAt)
          .map((v) => ({ id: v.id, rev: v.rev, frozenAt: v.frozenAt?.toISOString(), changeSummary: v.changeSummary, total: v.total })),
        payments: inv.payments.map((p) => ({
          id: p.id,
          kind: p.kind,
          amountMinor: p.amount,
          receivedOn: d2s(p.receivedOn),
          method: p.method,
          note: p.note,
          deleted: !!p.deletedAt,
        })),
        activity: inv.activity.map((a) => ({ id: a.id, kind: a.kind, actor: a.actor, data: a.data, at: a.at.toISOString() })),
        emails: inv.emails.map((e) => ({
          id: e.id,
          kind: e.kind,
          to: e.to,
          cc: e.cc,
          subject: e.subject,
          textBody: e.textBody,
          status: e.status,
          attempts: e.attempts,
          lastError: e.lastError,
          attachments: e.attachments,
          queuedAt: e.queuedAt.toISOString(),
          sentAt: e.sentAt?.toISOString() ?? null,
          transport: e.transport,
        })),
        accounts: accounts.map((a) => ({ id: a.id, label: a.label, bankName: a.bankName, last4: (a.iban ?? a.accountNumber ?? "").slice(-4), isDefault: a.isDefault })),
        canVoid: inv.status === "issued" && netPaidMinor === 0,
      };
    });
  }

  /** Autosave of a draft or an open correction (S11). */
  @Patch(":id/draft")
  async updateDraft(@C() ctx: Ctx, @Param("id") id: string, @Body() body: unknown) {
    const input = parse(DraftUpdateInput, body);
    const ws = ctx.workspace;
    return this.prisma.$transaction(async (tx) => {
      const inv = await this.lockInvoice(tx, ctx, id);
      const v = await tx.invoiceVersion.findFirst({ where: { invoiceId: id, frozenAt: null }, include: { lines: { include: { entries: true } }, taxes: true } });
      if (!v) throw conflict("frozen", "Sent invoices can't be edited. Correct the invoice instead.");
      const data: Prisma.InvoiceVersionUncheckedUpdateInput = {};
      if (input.summary !== undefined) data.summary = input.summary;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.changeSummary !== undefined) data.changeSummary = input.changeSummary;
      if (input.termsDays !== undefined) data.termsDays = input.termsDays;
      if (input.dueDate !== undefined) {
        data.dueDate = input.dueDate ? s2d(input.dueDate) : null;
        data.dueDateManual = !!input.dueDate;
      }
      if (input.issueDate !== undefined && inv.status === "draft") {
        if (input.issueDate && input.issueDate > todayIn(ws.timeZone)) throw invalid("The issue date can't be in the future.");
        data.issueDate = input.issueDate ? s2d(input.issueDate) : null;
      }
      if (input.paymentAccountMode !== undefined) {
        data.paymentAccountMode = input.paymentAccountMode;
        data.paymentAccountId = input.paymentAccountMode === "account" ? (input.paymentAccountId ?? null) : null;
        // An explicit choice un-pins the snapshot so the account is read live until send.
        data.paymentAccountSnapshot = Prisma.DbNull;
      }
      await tx.invoiceVersion.update({ where: { id: v.id }, data });

      const taxIdMap = new Map<string, string>();
      if (input.taxes) {
        const keep = new Set(input.taxes.filter((t) => t.id && v.taxes.some((x) => x.id === t.id)).map((t) => t.id as string));
        await tx.invoiceVersionTax.deleteMany({ where: { versionId: v.id, id: { notIn: [...keep] } } });
        let pos = 0;
        for (const t of input.taxes) {
          if (t.id && keep.has(t.id)) {
            await tx.invoiceVersionTax.update({ where: { id: t.id }, data: { name: t.name, rateBp: t.rateBp, position: pos++ } });
            taxIdMap.set(t.id, t.id);
          } else {
            const nt = await tx.invoiceVersionTax.create({ data: { versionId: v.id, name: t.name, rateBp: t.rateBp, position: pos++ } });
            if (t.id) taxIdMap.set(t.id, nt.id);
          }
        }
      }
      for (const t of v.taxes) if (!taxIdMap.has(t.id) && !input.taxes) taxIdMap.set(t.id, t.id);

      if (input.lines) {
        const discounts = input.lines.filter((l) => l.kind === "discount");
        if (discounts.length > 1) throw invalid("An invoice can have one discount line.");
        const incoming = new Set(input.lines.filter((l) => l.id).map((l) => l.id));
        const removed = v.lines.filter((l) => !incoming.has(l.id));
        // Draft rev 1: time removed from the draft goes back to unbilled at once.
        // A correction releases removed entries only when it is approved (08 §4.2).
        const releaseIds = removed.flatMap((l) => l.entries.map((e) => e.timeEntryId));
        await tx.invoiceLine.deleteMany({ where: { id: { in: removed.map((l) => l.id) } } });
        if (inv.status === "draft" && releaseIds.length) {
          await tx.timeEntry.updateMany({ where: { id: { in: releaseIds }, invoiceId: id }, data: { invoiceId: null } });
          await this.events.emit(tx, { ws: ws.id, member: ctx.member.id, topic: "time", action: "released" });
        }
        const nonDiscountSum = input.lines.filter((l) => l.kind !== "discount").reduce((s, l) => s + lineAmount(l.qtyHundredths, l.rateMinor), 0);
        let pos = 0;
        for (const l of input.lines) {
          const existing = l.id ? v.lines.find((x) => x.id === l.id) : undefined;
          if (l.kind === "time" && !existing) throw invalid("Add time from the builder, not as a line.");
          const rate = l.kind === "discount" ? (l.discountRateBp != null ? -percentOf(nonDiscountSum, l.discountRateBp) : -Math.abs(l.rateMinor)) : l.rateMinor;
          const qty = l.kind === "discount" ? 100 : l.qtyHundredths;
          const overrides = new Set<string>((existing?.overrides as string[]) ?? []);
          if (existing && (existing.kind === "time" || existing.kind === "fixed")) {
            if (existing.title !== l.title) overrides.add("title");
            if (existing.detail !== l.detail) overrides.add("detail");
            if (existing.qtyHundredths !== qty) overrides.add("qtyHundredths");
            if (existing.rateMinor !== rate) overrides.add("rateMinor");
          }
          const fields = {
            position: pos++,
            title: l.title,
            detail: l.detail,
            qtyHundredths: qty,
            unit: l.kind === "discount" ? "" : l.unit,
            rateMinor: rate,
            amountMinor: lineAmount(qty, rate),
            discountRateBp: l.kind === "discount" ? (l.discountRateBp ?? null) : null,
            overrides: [...overrides],
          };
          const line = existing
            ? await tx.invoiceLine.update({ where: { id: existing.id }, data: fields })
            : await tx.invoiceLine.create({ data: { ...fields, versionId: v.id, kind: l.kind } });
          await tx.invoiceLineTax.deleteMany({ where: { lineId: line.id } });
          const taxIds = l.taxIds.map((t) => taxIdMap.get(t) ?? t).filter((t) => [...taxIdMap.values()].includes(t));
          if (taxIds.length) await tx.invoiceLineTax.createMany({ data: taxIds.map((t) => ({ lineId: line.id, versionTaxId: t })) });
        }
      }
      const s = await writeTotals(tx, v.id);
      if (s.errors.length) throw invalid(s.errors[0]);
      await this.emit(tx, ctx, "draft_saved", id);
      const lineIds = (await tx.invoiceLine.findMany({ where: { versionId: v.id }, orderBy: { position: "asc" }, select: { id: true } })).map((l) => l.id);
      return { ok: true, savedAt: new Date().toISOString(), taxIdMap: Object.fromEntries(taxIdMap), lineIds, totalMinor: s.totalMinor };
    });
  }

  /** "N lines out of date · Update" (08 §5.2). */
  @Post(":id/update-lines")
  @HttpCode(200)
  async updateLines(@C() ctx: Ctx, @Param("id") id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockInvoice(tx, ctx, id);
      const v = await tx.invoiceVersion.findFirst({ where: { invoiceId: id, frozenAt: null } });
      if (!v) throw conflict("frozen", "Nothing to update on a sent invoice.");
      const layout = v.lineLayout as unknown as LineLayout;
      const ids = await outdatedLineIds(tx, ctx.workspace, v.id, layout);
      await regenerateLines(tx, ctx.workspace, v.id, layout, { onlyLineIds: ids });
      await writeTotals(tx, v.id);
      await this.emit(tx, ctx, "draft_saved", id);
      return { updated: ids.length };
    });
  }

  @Delete(":id")
  async deleteDraft(@C() ctx: Ctx, @Param("id") id: string) {
    return this.prisma.$transaction(async (tx) => {
      const inv = await this.lockInvoice(tx, ctx, id);
      if (inv.status !== "draft") throw conflict("not_draft", "Only drafts can be deleted. Void a sent invoice instead.");
      const released = await tx.timeEntry.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
      await tx.outboundEmail.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
      await tx.invoice.delete({ where: { id } });
      await this.emit(tx, ctx, "deleted", id);
      await this.events.emit(tx, { ws: ctx.workspace.id, member: ctx.member.id, topic: "time", action: "released" });
      return { released: released.count };
    });
  }

  // ── Sending (08 §7, S12) ─────────────────────────────────────────────────────────────────

  @Get(":id/email")
  async emailPreview(@C() ctx: Ctx, @Param("id") id: string, @Query("kind") kindQ = "invoice") {
    const kind = (["invoice", "correction", "reminder", "thank_you"].includes(kindQ) ? kindQ : "invoice") as EmailKind;
    const ws = ctx.workspace;
    const inv = await this.prisma.invoice.findFirst({ where: { id, workspaceId: ws.id }, include: { client: true, versions: { orderBy: { rev: "desc" } } } });
    if (!inv) throw notFound("Invoice not found");
    const tpl = (await this.prisma.emailTemplate.findUnique({ where: { workspaceId_kind: { workspaceId: ws.id, kind } } })) ?? DEFAULT_TEMPLATES[kind];
    const v = kind === "correction" || inv.status === "draft" ? inv.versions.find((x) => !x.frozenAt) : inv.versions.find((x) => x.id === inv.currentVersionId);
    const issue = d2s(v?.issueDate) ?? todayIn(ws.timeZone);
    const due = v?.dueDateManual ? d2s(v.dueDate) : inv.status === "draft" ? addDays(issue, v?.termsDays ?? ws.defaultTermsDays) : d2s(v?.dueDate);
    const netPaid = await this.netPaid(this.prisma, id);
    const vars = emailVars({
      ws,
      client: inv.client,
      number: inv.number,
      rev: v?.rev ?? 1,
      currency: inv.currency,
      totalMinor: v?.total ?? 0,
      netPaidMinor: netPaid,
      dueDate: due,
      token: inv.publicToken,
      changesSummary: v?.changeSummary,
    });
    if (inv.status === "draft") vars.number = "{{number}}";
    const subject = fillTemplate(withoutLinkLines(tpl.subject), vars);
    const message = fillTemplate(withoutLinkLines(tpl.body), vars);
    const account = v ? await resolveAccount(this.prisma as unknown as Tx, ws, inv.client, v, inv.currency) : null;
    return {
      kind,
      to: inv.client.billingEmails,
      subject: subject.text,
      message: message.text,
      missing: [...subject.missing, ...message.missing].filter((m) => m !== "number"),
      attachment: `${inv.number ?? "invoice"}.pdf`,
      publicLinks: env.PUBLIC_INVOICE_LINKS,
      noPaymentAccount: !account && v?.paymentAccountMode !== "none",
      currency: inv.currency,
      issueDate: issue,
      me: ctx.member.email,
    };
  }

  /** T1 (08 §7.2): number, freeze, email outbox, activity — one transaction. */
  @Post(":id/send")
  @HttpCode(200)
  async send(@C() ctx: Ctx, @Param("id") id: string, @Body() body: unknown) {
    const input = parse(SendInput, body);
    if (input.kind === "test") return this.sendTest(ctx, id, input);
    if (input.kind === "reminder") return this.sendReminder(ctx, id, input);
    const ws = ctx.workspace;
    return this.prisma.$transaction(async (tx) => {
      const dupe = await tx.outboundEmail.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (dupe) return { ok: true, number: (await tx.invoice.findUnique({ where: { id } }))?.number, repeated: true };
      const inv = await this.lockInvoice(tx, ctx, id);
      const v = await tx.invoiceVersion.findFirst({ where: { invoiceId: id, frozenAt: null }, include: versionInclude });
      if (!v) {
        if (inv.status === "issued") return this.resend(tx, ctx, inv.id, input);
        throw conflict("nothing_to_send", "There's nothing to send.");
      }
      return this.freezeAndSend(tx, ctx, inv.id, v.id, { send: input, changeSummary: v.changeSummary });
    });
  }

  private async freezeAndSend(
    tx: Tx,
    ctx: Ctx,
    invoiceId: string,
    versionId: string,
    opts: { send?: { idempotencyKey: string; to: string[]; cc: string[]; subject: string; message: string; issueDate?: string }; changeSummary?: string | null; markSent?: { issueDate?: string } },
  ) {
    const ws = ctx.workspace;
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { client: true } });
    const v = await tx.invoiceVersion.findUniqueOrThrow({ where: { id: versionId }, include: versionInclude });
    if (v.lines.length === 0) throw invalid("Add at least one line before sending.");
    const isFirst = inv.status === "draft";
    if (!isFirst && !opts.changeSummary?.trim()) throw invalid("Say what changed in this correction.", { fields: { changeSummary: "Required" } });
    if (opts.send && /\{\{\s*[a-z_]+\s*\}\}/.test((opts.send.subject + opts.send.message).replace(/\{\{\s*number\s*\}\}/g, ""))) {
      throw invalid("Fill in the highlighted template variables before sending.");
    }
    let number = inv.number;
    let numberFields = {};
    const extra: Record<string, unknown> = {};
    if (isFirst) {
      const today = todayIn(ws.timeZone);
      const issueDate = opts.send?.issueDate ?? opts.markSent?.issueDate ?? d2s(v.issueDate) ?? today;
      if (issueDate > today) throw invalid("The issue date can't be in the future.");
      const n = await assignNumber(tx, ws, invoiceId, issueDate);
      number = n.number;
      extra.issueDate = s2d(issueDate);
      extra.dueDate = v.dueDateManual && v.dueDate ? v.dueDate : s2d(addDays(issueDate, v.termsDays));
      numberFields = { number: n.number, numberSeq: n.seq, numberPeriod: n.period };
    } else {
      // Corrections: apply staged entry changes and release entries the correction removed.
      await applyStagedChanges(tx, ws, versionId, v.lineLayout as unknown as LineLayout);
      const linked = await tx.invoiceLineEntry.findMany({ where: { line: { versionId } }, select: { timeEntryId: true } });
      await tx.timeEntry.updateMany({
        where: { invoiceId, id: { notIn: linked.map((l) => l.timeEntryId) } },
        data: { invoiceId: null },
      });
      extra.changeSummary = opts.changeSummary;
    }
    const sheet = await freezeVersion(tx, ctx, invoiceId, versionId, extra as never);
    // Number and status change in one statement: `number IS NULL ⇔ draft` is a check (08 §3.1).
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "issued", currentVersionId: versionId, ...numberFields } });
    if (isFirst) {
      await tx.invoiceActivity.create({ data: { invoiceId, kind: "created", actor: "member", actorId: ctx.member.id, at: inv.createdAt, data: {} } });
    }
    if (opts.send) {
      const netPaid = await this.netPaid(tx, invoiceId);
      const vars = emailVars({ ws, client: inv.client, number, rev: v.rev, currency: inv.currency, totalMinor: sheet.totalMinor, netPaidMinor: netPaid, dueDate: sheet.dueDate, token: inv.publicToken, changesSummary: opts.changeSummary });
      const email = await queueEmail(tx, ctx, {
        invoiceId,
        versionId,
        kind: isFirst ? "invoice" : "correction",
        idempotencyKey: opts.send.idempotencyKey,
        to: opts.send.to,
        cc: opts.send.cc,
        subject: fillTemplate(withoutLinkLines(opts.send.subject), vars).text,
        text: fillTemplate(withoutLinkLines(opts.send.message), vars).text,
      });
      await tx.invoiceActivity.create({
        data: { invoiceId, versionId, kind: isFirst ? "sent" : "correction_sent", actor: "member", actorId: ctx.member.id, data: { to: opts.send.to, rev: v.rev, emailId: email.id, changeSummary: opts.changeSummary ?? null } },
      });
    } else {
      await tx.invoiceActivity.create({
        data: { invoiceId, versionId, kind: isFirst ? "marked_sent" : "correction_saved", actor: "member", actorId: ctx.member.id, data: { rev: v.rev, changeSummary: opts.changeSummary ?? null } },
      });
    }
    await this.emit(tx, ctx, isFirst ? "sent" : "corrected", invoiceId);
    await this.events.emit(tx, { ws: ws.id, member: ctx.member.id, topic: "time", action: "invoiced" });
    return { ok: true, number, rev: v.rev, to: opts.send?.to ?? [] };
  }

  private async resend(tx: Tx, ctx: Ctx, invoiceId: string, input: { idempotencyKey: string; to: string[]; cc: string[]; subject: string; message: string }) {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const email = await queueEmail(tx, ctx, { invoiceId, versionId: inv.currentVersionId, kind: "invoice", ...input, text: input.message });
    await tx.invoiceActivity.create({ data: { invoiceId, versionId: inv.currentVersionId, kind: "resent", actor: "member", actorId: ctx.member.id, data: { to: input.to, emailId: email.id } } });
    await this.emit(tx, ctx, "resent", invoiceId);
    return { ok: true, number: inv.number, to: input.to };
  }

  private async sendReminder(ctx: Ctx, id: string, input: { idempotencyKey: string; to: string[]; cc: string[]; subject: string; message: string }) {
    return this.prisma.$transaction(async (tx) => {
      const dupe = await tx.outboundEmail.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (dupe) return { ok: true, repeated: true };
      const inv = await this.lockInvoice(tx, ctx, id);
      if (inv.status !== "issued") throw conflict("not_issued", "Reminders are for sent invoices.");
      const email = await queueEmail(tx, ctx, { invoiceId: id, versionId: inv.currentVersionId, kind: "reminder", ...input, text: input.message });
      await tx.invoiceActivity.create({ data: { invoiceId: id, versionId: inv.currentVersionId, kind: "reminded", actor: "member", actorId: ctx.member.id, data: { to: input.to, emailId: email.id } } });
      await this.emit(tx, ctx, "reminded", id);
      return { ok: true, number: inv.number, to: input.to };
    });
  }

  /** A watermarked, unnumbered copy to the current member only; nothing is frozen (08 §7.5). */
  private async sendTest(ctx: Ctx, id: string, input: { idempotencyKey: string; subject: string; message: string }) {
    return this.prisma.$transaction(async (tx) => {
      const inv = await this.lockInvoice(tx, ctx, id);
      const v = await tx.invoiceVersion.findFirst({ where: { invoiceId: id, frozenAt: null } });
      if (!v) throw conflict("frozen", "Send test works on a draft or an open correction.");
      await queueEmail(tx, ctx, {
        invoiceId: null,
        versionId: v.id,
        kind: "test",
        idempotencyKey: input.idempotencyKey,
        to: [ctx.member.email],
        cc: [],
        subject: `[Test] ${input.subject}`,
        text: input.message,
      });
      return { ok: true, to: [ctx.member.email], number: inv.number };
    });
  }

  @Post(":id/mark-sent")
  @HttpCode(200)
  async markSent(@C() ctx: Ctx, @Param("id") id: string, @Body() body: unknown) {
    const input = parse(MarkSentInput, body);
    return this.prisma.$transaction(async (tx) => {
      const inv = await this.lockInvoice(tx, ctx, id);
      if (inv.status !== "draft") throw conflict("not_draft", "This invoice was already sent.");
      const v = await tx.invoiceVersion.findFirstOrThrow({ where: { invoiceId: id, frozenAt: null } });
      return this.freezeAndSend(tx, ctx, id, v.id, { markSent: { issueDate: input.issueDate } });
    });
  }

  @Post(":id/emails/:emailId/retry")
  @HttpCode(200)
  async retryEmail(@C() ctx: Ctx, @Param("id") id: string, @Param("emailId") emailId: string) {
    const r = await this.prisma.outboundEmail.updateMany({
      where: { id: emailId, invoiceId: id, workspaceId: ctx.workspace.id, status: "failed" },
      data: { status: "queued", attempts: 0, lastError: null },
    });
    return { ok: r.count > 0 };
  }

  // ── Corrections (08 §4) ──────────────────────────────────────────────────────────────────

  @Post(":id/correct")
  @HttpCode(200)
  async correct(@C() ctx: Ctx, @Param("id") id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockInvoice(tx, ctx, id);
      const v = await openCorrectionTx(tx, ctx, id);
      await this.emit(tx, ctx, "correction_opened", id);
      return { versionId: v.id, rev: v.rev };
    });
  }

  @Post(":id/correction/refresh-details")
  @HttpCode(200)
  async refreshDetails(@C() ctx: Ctx, @Param("id") id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockInvoice(tx, ctx, id);
      const v = await tx.invoiceVersion.findFirst({ where: { invoiceId: id, frozenAt: null } });
      if (!v) throw conflict("no_correction", "Open a correction first.");
      await tx.invoiceVersion.update({
        where: { id: v.id },
        data: { fromSnapshot: Prisma.DbNull, toSnapshot: Prisma.DbNull, paymentAccountSnapshot: Prisma.DbNull, paymentAccountMode: "default", paymentAccountId: null },
      });
      await this.emit(tx, ctx, "draft_saved", id);
      return { ok: true };
    });
  }

  @Post(":id/correction/approve")
  @HttpCode(200)
  async approve(@C() ctx: Ctx, @Param("id") id: string, @Body() body: unknown) {
    const input = parse(ApproveCorrectionInput, body);
    return this.prisma.$transaction(async (tx) => {
      if (input.send) {
        const dupe = await tx.outboundEmail.findUnique({ where: { idempotencyKey: input.send.idempotencyKey } });
        if (dupe) return { ok: true, repeated: true };
      }
      const inv = await this.lockInvoice(tx, ctx, id);
      if (inv.status !== "issued") throw conflict("not_issued", "Only sent invoices have corrections.");
      const v = await tx.invoiceVersion.findFirst({ where: { invoiceId: id, frozenAt: null } });
      if (!v) throw conflict("no_correction", "There's no open correction.");
      return this.freezeAndSend(tx, ctx, id, v.id, { send: input.send, changeSummary: input.changeSummary });
    });
  }

  @Delete(":id/correction")
  async discardCorrection(@C() ctx: Ctx, @Param("id") id: string) {
    return this.prisma.$transaction(async (tx) => {
      const inv = await this.lockInvoice(tx, ctx, id);
      const v = await tx.invoiceVersion.findFirst({ where: { invoiceId: id, frozenAt: null } });
      if (!v || inv.status !== "issued") throw conflict("no_correction", "There's no open correction.");
      // Release only the entries this correction added (not linked in the current version).
      const linked = await tx.invoiceLineEntry.findMany({ where: { line: { versionId: inv.currentVersionId as string } }, select: { timeEntryId: true } });
      await tx.timeEntry.updateMany({ where: { invoiceId: id, id: { notIn: linked.map((l) => l.timeEntryId) } }, data: { invoiceId: null } });
      await tx.invoiceVersion.delete({ where: { id: v.id } });
      await tx.invoiceActivity.create({ data: { invoiceId: id, kind: "correction_discarded", actor: "member", actorId: ctx.member.id, data: { rev: v.rev } } });
      await this.emit(tx, ctx, "correction_discarded", id);
      return { ok: true };
    });
  }

  // ── Void, duplicate (08 §4.3–4.4) ────────────────────────────────────────────────────────

  @Post(":id/void")
  @HttpCode(200)
  async void(@C() ctx: Ctx, @Param("id") id: string, @Body() body: unknown) {
    const input = parse(VoidInput, body);
    return this.prisma.$transaction(async (tx) => {
      const inv = await this.lockInvoice(tx, ctx, id);
      if (inv.status !== "issued") throw conflict("not_issued", "Only sent invoices can be voided. Delete a draft instead.");
      if ((await this.netPaid(tx, id)) !== 0) {
        throw conflict("has_payments", "Refund or remove the payments first, or correct the invoice instead.");
      }
      const open = await tx.invoiceVersion.findFirst({ where: { invoiceId: id, frozenAt: null } });
      if (open) await tx.invoiceVersion.delete({ where: { id: open.id } });
      await tx.invoice.update({ where: { id }, data: { status: "void", voidedAt: new Date(), voidedBy: ctx.member.id, voidReason: input.reason ?? null } });
      const released = await tx.timeEntry.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
      await tx.invoiceActivity.create({ data: { invoiceId: id, kind: "voided", actor: "member", actorId: ctx.member.id, data: { reason: input.reason ?? null, released: released.count } } });
      await this.emit(tx, ctx, "voided", id);
      await this.events.emit(tx, { ws: ctx.workspace.id, member: ctx.member.id, topic: "time", action: "released" });
      return { released: released.count };
    });
  }

  @Post(":id/duplicate")
  @HttpCode(200)
  async duplicate(@C() ctx: Ctx, @Param("id") id: string) {
    return this.prisma.$transaction(async (tx) => {
      const src = await tx.invoice.findFirst({
        where: { id, workspaceId: ctx.workspace.id },
        include: { currentVersion: { include: versionInclude }, versions: { where: { frozenAt: null }, include: versionInclude } },
      });
      if (!src) throw notFound("Invoice not found");
      const v = src.currentVersion ?? src.versions[0];
      if (!v) throw conflict("no_version", "Nothing to duplicate.");
      const client = await tx.client.findUniqueOrThrow({ where: { id: src.clientId } });
      const inv = await tx.invoice.create({ data: { workspaceId: ctx.workspace.id, clientId: src.clientId, currency: src.currency, publicToken: newPublicToken() } });
      const nv = await tx.invoiceVersion.create({
        data: {
          invoiceId: inv.id,
          rev: 1,
          termsDays: client.termsDays ?? ctx.workspace.defaultTermsDays,
          summary: v.summary,
          notes: v.notes,
          lineLayout: v.lineLayout as Prisma.InputJsonValue,
        },
      });
      const taxMap = new Map<string, string>();
      for (const t of v.taxes) {
        const nt = await tx.invoiceVersionTax.create({ data: { versionId: nv.id, name: t.name, rateBp: t.rateBp, position: t.position } });
        taxMap.set(t.id, nt.id);
      }
      let hadTime = false;
      for (const l of v.lines) {
        // All lines become manual lines: no time links (08 §4.4)
        if (l.kind === "time" || l.kind === "fixed") hadTime = true;
        const kind = l.kind === "discount" ? "discount" : "manual";
        const nl = await tx.invoiceLine.create({
          data: { versionId: nv.id, position: l.position, kind, title: l.title, detail: l.detail, qtyHundredths: l.qtyHundredths, unit: l.unit, rateMinor: l.rateMinor, amountMinor: l.amountMinor, discountRateBp: l.discountRateBp },
        });
        if (l.taxes.length) await tx.invoiceLineTax.createMany({ data: l.taxes.map((t) => ({ lineId: nl.id, versionTaxId: taxMap.get(t.versionTaxId) as string })) });
      }
      await writeTotals(tx, nv.id);
      await this.emit(tx, ctx, "draft_created", inv.id);
      return { id: inv.id, hadTime };
    });
  }

  // ── Payments (08 §8, S13) ────────────────────────────────────────────────────────────────

  @Post(":id/payments")
  async addPayment(@C() ctx: Ctx, @Param("id") id: string, @Body() body: unknown) {
    const input = parse(PaymentInput, body);
    const thankYou = (body as { thankYou?: boolean })?.thankYou === true;
    const ws = ctx.workspace;
    return this.prisma.$transaction(async (tx) => {
      const inv = await this.lockInvoice(tx, ctx, id);
      if (inv.status !== "issued") throw conflict("not_issued", "Payments are recorded on sent invoices.");
      const cur = await tx.invoiceVersion.findUniqueOrThrow({ where: { id: inv.currentVersionId as string } });
      const before = await this.netPaid(tx, id);
      const p = await tx.payment.create({
        data: { invoiceId: id, kind: input.kind, amount: input.amountMinor, receivedOn: s2d(input.receivedOn), method: input.method, note: input.note ?? "", createdBy: ctx.member.id },
      });
      const after = before + (input.kind === "payment" ? input.amountMinor : -input.amountMinor);
      await tx.invoiceActivity.create({
        data: { invoiceId: id, kind: input.kind === "payment" ? "payment_recorded" : "refund_recorded", actor: "member", actorId: ctx.member.id, data: { amountMinor: input.amountMinor, receivedOn: input.receivedOn, paymentId: p.id } },
      });
      // "Paid" is an event, logged when net paid reaches the total (08 §2.1).
      if (before < (cur.total ?? 0) && after >= (cur.total ?? 0)) {
        await tx.invoiceActivity.create({ data: { invoiceId: id, kind: "paid", actor: "system", data: { on: input.receivedOn } } });
      }
      if (thankYou && input.kind === "payment" && inv.client.billingEmails.length) {
        const tpl = (await tx.emailTemplate.findUnique({ where: { workspaceId_kind: { workspaceId: ws.id, kind: "thank_you" } } })) ?? DEFAULT_TEMPLATES.thank_you;
        const vars = emailVars({ ws, client: inv.client, number: inv.number, rev: cur.rev, currency: inv.currency, totalMinor: cur.total ?? 0, netPaidMinor: after, dueDate: d2s(cur.dueDate), token: inv.publicToken, paidMinor: input.amountMinor });
        const email = await queueEmail(tx, ctx, { invoiceId: id, versionId: null, kind: "thank_you", idempotencyKey: randomUUID(), to: inv.client.billingEmails, cc: [], subject: fillTemplate(withoutLinkLines(tpl.subject), vars).text, text: fillTemplate(withoutLinkLines(tpl.body), vars).text });
        await tx.invoiceActivity.create({ data: { invoiceId: id, kind: "thanked", actor: "member", actorId: ctx.member.id, data: { emailId: email.id } } });
      }
      await this.emit(tx, ctx, "payment", id);
      return { id: p.id, overpaidMinor: Math.max(0, after - (cur.total ?? 0)) };
    });
  }

  /** Removing a payment is a person's action with undo; the system never removes payments. */
  @Delete(":id/payments/:pid")
  async removePayment(@C() ctx: Ctx, @Param("id") id: string, @Param("pid") pid: string) {
    return this.setPaymentDeleted(ctx, id, pid, true);
  }

  @Post(":id/payments/:pid/restore")
  @HttpCode(200)
  async restorePayment(@C() ctx: Ctx, @Param("id") id: string, @Param("pid") pid: string) {
    return this.setPaymentDeleted(ctx, id, pid, false);
  }

  private async setPaymentDeleted(ctx: Ctx, id: string, pid: string, deleted: boolean) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockInvoice(tx, ctx, id);
      const r = await tx.payment.updateMany({
        where: { id: pid, invoiceId: id },
        data: deleted ? { deletedAt: new Date(), deletedBy: ctx.member.id } : { deletedAt: null, deletedBy: null },
      });
      if (!r.count) throw notFound("Payment not found");
      await tx.invoiceActivity.create({ data: { invoiceId: id, kind: deleted ? "payment_removed" : "payment_restored", actor: "member", actorId: ctx.member.id, data: { paymentId: pid } } });
      await this.emit(tx, ctx, "payment", id);
      return { ok: true };
    });
  }

  @Post(":id/notes")
  @HttpCode(200)
  async addNote(@C() ctx: Ctx, @Param("id") id: string, @Body() body: { text?: string }) {
    const text = String(body?.text ?? "").trim().slice(0, 2000);
    if (!text) throw invalid("Write a note first.");
    await this.prisma.$transaction(async (tx) => {
      await this.lockInvoice(tx, ctx, id);
      await tx.invoiceActivity.create({ data: { invoiceId: id, kind: "note", actor: "member", actorId: ctx.member.id, data: { text, by: ctx.member.name } } });
      await this.emit(tx, ctx, "note", id);
    });
    return { ok: true };
  }

  @Post(":id/regenerate-link")
  @HttpCode(200)
  async regenerateLink(@C() ctx: Ctx, @Param("id") id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockInvoice(tx, ctx, id);
      const token = newPublicToken();
      await tx.invoice.update({ where: { id }, data: { publicToken: token } });
      await tx.invoiceActivity.create({ data: { invoiceId: id, kind: "link_regenerated", actor: "member", actorId: ctx.member.id, data: {} } });
      return { url: publicLink(token) };
    });
  }

  // ── PDF ──────────────────────────────────────────────────────────────────────────────────

  @Get(":id/pdf")
  async pdfDownload(@C() ctx: Ctx, @Param("id") id: string, @Query("version") versionId: string | undefined, @Res() reply: FastifyReply) {
    const inv = await this.prisma.invoice.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
    if (!inv) throw notFound("Invoice not found");
    const vid = versionId ?? inv.currentVersionId;
    let bytes: Buffer;
    let name = `${inv.number ?? "draft"}.pdf`;
    if (!vid) {
      const open = await this.prisma.invoiceVersion.findFirst({ where: { invoiceId: id, frozenAt: null } });
      if (!open) throw notFound("No version");
      bytes = await this.pdf.renderVersion(open.id, { watermark: true });
      name = "draft-preview.pdf";
    } else {
      const v = await this.prisma.invoiceVersion.findFirst({ where: { id: vid, invoiceId: id } });
      if (!v) throw notFound("Version not found");
      bytes = v.frozenAt ? await this.pdf.storedOrRender(vid) : await this.pdf.renderVersion(vid, { watermark: true });
      if (v.rev > 1) name = `${inv.number}-rev${v.rev}.pdf`;
    }
    reply.header("Content-Type", "application/pdf").header("Content-Disposition", `inline; filename="${name}"`).send(bytes);
  }
}

export { ApiError };
