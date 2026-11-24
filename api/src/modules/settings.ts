import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import {
  DefaultTaxInput,
  formatInvoiceNumber,
  isValidTimeZone,
  MemberInviteInput,
  numberPeriod,
  PaymentAccountInput,
  ProfileInput,
  todayIn,
  validateNumberFormat,
  WorkspaceSettingsInput,
} from "@paypure/domain";
import * as argon2 from "argon2";
import { AdminOnly, C, type Ctx, hashToken, newToken } from "../common/auth";
import { conflict, invalid, notFound } from "../common/errors";
import { parse } from "../common/zod";
import { env } from "../env";
import { PrismaService, type Tx } from "../prisma.service";
import { DEFAULT_TEMPLATES } from "./invoice-ops";

type TemplateKind = keyof typeof DEFAULT_TEMPLATES;

/** Settings (S16): Profile · Business · Invoicing · Members. */
@Controller("v1/settings")
export class SettingsController {
  constructor(private readonly prisma: PrismaService) {}

  private async nextNumber(db: Tx | PrismaService, ctx: Ctx, format?: string, reset?: "never" | "yearly") {
    const ws = ctx.workspace;
    const today = todayIn(ws.timeZone);
    const period = numberPeriod(reset ?? ws.numberReset, today);
    const seq = await db.invoiceSequence.findUnique({ where: { workspaceId_period: { workspaceId: ws.id, period } } });
    const max = await db.invoice.aggregate({ where: { workspaceId: ws.id, numberPeriod: period }, _max: { numberSeq: true } });
    const next = Math.max(seq?.nextSeq ?? 1, (max._max.numberSeq ?? 0) + 1);
    return { next, maxUsed: max._max.numberSeq ?? 0, preview: formatInvoiceNumber(format ?? ws.numberFormat, next, today), period };
  }

  @AdminOnly()
  @Get("workspace")
  async workspace(@C() ctx: Ctx) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: ctx.workspace.id } });
    const taxes = await this.prisma.workspaceDefaultTax.findMany({ where: { workspaceId: ws.id }, orderBy: { position: "asc" } });
    const accounts = await this.prisma.paymentAccount.findMany({ where: { workspaceId: ws.id }, orderBy: [{ archivedAt: "asc" }, { currency: "asc" }, { label: "asc" }] });
    const usedAccounts = await this.prisma.invoiceVersion.findMany({
      where: { paymentAccountId: { in: accounts.map((a) => a.id) }, frozenAt: { not: null } },
      select: { paymentAccountId: true },
      distinct: ["paymentAccountId"],
    });
    const templates = await this.prisma.emailTemplate.findMany({ where: { workspaceId: ws.id } });
    return {
      workspace: ws,
      taxes,
      accounts: accounts.map((a) => ({ ...a, used: usedAccounts.some((u) => u.paymentAccountId === a.id) })),
      templates: (Object.keys(DEFAULT_TEMPLATES) as TemplateKind[]).map((k) => {
        const t = templates.find((x) => x.kind === k);
        return { kind: k, subject: t?.subject ?? DEFAULT_TEMPLATES[k].subject, body: t?.body ?? DEFAULT_TEMPLATES[k].body };
      }),
      numbering: await this.nextNumber(this.prisma, ctx),
      publicLinks: env.PUBLIC_INVOICE_LINKS,
    };
  }

  @AdminOnly()
  @Patch("workspace")
  async updateWorkspace(@C() ctx: Ctx, @Body() body: unknown) {
    const input = parse(WorkspaceSettingsInput, body);
    const { nextNumber, ...data } = input;
    if (data.timeZone && !isValidTimeZone(data.timeZone)) throw invalid("Choose a valid time zone.", { fields: { timeZone: "Unknown time zone" } });
    const format = data.numberFormat ?? ctx.workspace.numberFormat;
    const reset = data.numberReset ?? ctx.workspace.numberReset;
    const err = validateNumberFormat(format, reset);
    if (err) throw invalid(err, { fields: { numberFormat: err } });
    await this.prisma.$transaction(async (tx) => {
      await tx.workspace.update({ where: { id: ctx.workspace.id }, data });
      if (nextNumber !== undefined) {
        const n = await this.nextNumber(tx, ctx, format, reset);
        if (nextNumber !== n.next) {
          // The next number can only go up, past every number already used (Brief §7.3).
          if (nextNumber < n.next) throw invalid(`The next number can only go up (at least ${n.next}).`, { fields: { nextNumber: "Too low" } });
          await tx.invoiceSequence.upsert({
            where: { workspaceId_period: { workspaceId: ctx.workspace.id, period: n.period } },
            create: { workspaceId: ctx.workspace.id, period: n.period, nextSeq: nextNumber },
            update: { nextSeq: nextNumber },
          });
        }
      }
    });
    return { ok: true };
  }

  @AdminOnly()
  @Post("taxes")
  async addTax(@C() ctx: Ctx, @Body() body: unknown) {
    const input = parse(DefaultTaxInput, body);
    const n = await this.prisma.workspaceDefaultTax.count({ where: { workspaceId: ctx.workspace.id } });
    const t = await this.prisma.workspaceDefaultTax.create({ data: { workspaceId: ctx.workspace.id, ...input, position: n } });
    return { id: t.id };
  }

  @AdminOnly()
  @Delete("taxes/:id")
  async removeTax(@C() ctx: Ctx, @Param("id") id: string) {
    await this.prisma.workspaceDefaultTax.deleteMany({ where: { id, workspaceId: ctx.workspace.id } });
    return { ok: true };
  }

  @AdminOnly()
  @Patch("templates/:kind")
  async updateTemplate(@C() ctx: Ctx, @Param("kind") kind: string, @Body() body: { subject?: string; body?: string }) {
    if (!(kind in DEFAULT_TEMPLATES)) throw notFound("Unknown template");
    const subject = String(body?.subject ?? "").trim();
    const text = String(body?.body ?? "").trim();
    if (!subject || !text) throw invalid("Subject and message can't be empty.");
    await this.prisma.emailTemplate.upsert({
      where: { workspaceId_kind: { workspaceId: ctx.workspace.id, kind: kind as TemplateKind } },
      create: { workspaceId: ctx.workspace.id, kind: kind as TemplateKind, subject, body: text },
      update: { subject, body: text },
    });
    return { ok: true };
  }

  // ── Payment accounts (07 §8) ─────────────────────────────────────────────────────────────

  @AdminOnly()
  @Post("accounts")
  async addAccount(@C() ctx: Ctx, @Body() body: unknown) {
    const input = parse(PaymentAccountInput, body);
    if (!input.accountNumber && !input.iban) throw invalid("Enter an account number or an IBAN.", { fields: { accountNumber: "Required" } });
    return this.prisma.$transaction(async (tx) => {
      const hasDefault = await tx.paymentAccount.count({ where: { workspaceId: ctx.workspace.id, currency: input.currency, isDefault: true, archivedAt: null } });
      const isDefault = input.isDefault || hasDefault === 0;
      if (isDefault) await tx.paymentAccount.updateMany({ where: { workspaceId: ctx.workspace.id, currency: input.currency }, data: { isDefault: false } });
      const a = await tx.paymentAccount.create({ data: { workspaceId: ctx.workspace.id, ...input, isDefault } });
      return { id: a.id };
    });
  }

  @AdminOnly()
  @Patch("accounts/:id")
  async updateAccount(@C() ctx: Ctx, @Param("id") id: string, @Body() body: unknown) {
    const input = parse(PaymentAccountInput.partial(), body);
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.paymentAccount.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
      if (!a) throw notFound("Account not found");
      if (input.isDefault) await tx.paymentAccount.updateMany({ where: { workspaceId: ctx.workspace.id, currency: input.currency ?? a.currency }, data: { isDefault: false } });
      // Editing an account never changes a sent invoice: they keep their snapshot (07 §8.2).
      await tx.paymentAccount.update({ where: { id }, data: input });
      return { ok: true };
    });
  }

  /** Used accounts are archived, unused ones deleted (07 §8.4). */
  @AdminOnly()
  @Delete("accounts/:id")
  async removeAccount(@C() ctx: Ctx, @Param("id") id: string) {
    const used = await this.prisma.invoiceVersion.count({ where: { paymentAccountId: id, frozenAt: { not: null } } });
    if (used > 0) {
      await this.prisma.paymentAccount.updateMany({ where: { id, workspaceId: ctx.workspace.id }, data: { archivedAt: new Date(), isDefault: false } });
      await this.prisma.client.updateMany({ where: { defaultPaymentAccountId: id }, data: { defaultPaymentAccountId: null } });
      return { archived: true };
    }
    await this.prisma.client.updateMany({ where: { defaultPaymentAccountId: id }, data: { defaultPaymentAccountId: null } });
    await this.prisma.paymentAccount.deleteMany({ where: { id, workspaceId: ctx.workspace.id } });
    return { deleted: true };
  }

  // ── Members ──────────────────────────────────────────────────────────────────────────────

  @AdminOnly()
  @Get("members")
  async members(@C() ctx: Ctx) {
    const ms = await this.prisma.member.findMany({ where: { workspaceId: ctx.workspace.id }, orderBy: { name: "asc" } });
    return ms.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, status: m.status }));
  }

  @AdminOnly()
  @Post("members")
  async invite(@C() ctx: Ctx, @Body() body: unknown) {
    const input = parse(MemberInviteInput, body);
    const email = input.email.toLowerCase();
    const exists = await this.prisma.member.findFirst({ where: { workspaceId: ctx.workspace.id, email } });
    if (exists) throw conflict("exists", "That email is already a member.");
    const token = newToken();
    await this.prisma.member.create({
      data: { workspaceId: ctx.workspace.id, name: input.name, email, role: input.role, status: "invited", inviteToken: hashToken(token), timeZone: ctx.workspace.timeZone },
    });
    // In v1 the invite email goes through the outbox; the prototype returns the link to copy.
    return { inviteUrl: `${process.env.PUBLIC_URL ?? "http://localhost:3000"}/invite/${token}` };
  }

  @AdminOnly()
  @Post("members/:id/deactivate")
  @HttpCode(200)
  async deactivate(@C() ctx: Ctx, @Param("id") id: string) {
    if (id === ctx.member.id) throw invalid("You can't deactivate yourself.");
    await this.prisma.$transaction(async (tx) => {
      await tx.member.updateMany({ where: { id, workspaceId: ctx.workspace.id }, data: { status: "deactivated" } });
      // Opaque sessions: deactivation takes effect immediately (T6).
      await tx.session.deleteMany({ where: { memberId: id } });
    });
    return { ok: true };
  }

  @Patch("profile")
  async profile(@C() ctx: Ctx, @Body() body: unknown) {
    const input = parse(ProfileInput, body);
    if (input.timeZone && !isValidTimeZone(input.timeZone)) throw invalid("Choose a valid time zone.", { fields: { timeZone: "Unknown time zone" } });
    const { password, ...data } = input;
    await this.prisma.member.update({
      where: { id: ctx.member.id },
      data: { ...data, ...(password ? { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) } : {}) },
    });
    return { ok: true };
  }
}
