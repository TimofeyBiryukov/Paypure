import { createHash } from "node:crypto";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import pino from "pino";
import { env } from "../env";
import { PrismaService } from "../prisma.service";
import { EventsService } from "./events";
import { PdfService } from "./pdf";

const mailLog = pino({ name: "mail" });
const MAX_ATTEMPTS = 5;

/** nodemailer over SMTP: Mailpit in dev, or a real account such as Gmail (see docs/email-setup.md). */
function createSmtp(): Transporter {
  const url = new URL(env.SMTP_URL);
  const secure = url.protocol === "smtps:";
  return nodemailer.createTransport({
    host: url.hostname,
    port: Number(url.port) || (secure ? 465 : 587),
    secure,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } } : {}),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

/**
 * The outbox (08 §7.3–7.4). Emails are rendered and stored in the send transaction; this loop
 * renders missing PDFs and delivers queued rows. Postgres is the queue (R3): rows are claimed
 * with FOR UPDATE SKIP LOCKED, so a second API instance would be safe.
 */
@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("outbox");
  private timer?: NodeJS.Timeout;
  private busy = false;
  /** Backoff per version after a failed render, so a broken template doesn't spin. */
  private readonly renderFailures = new Map<string, { n: number; next: number }>();
  private readonly smtp = env.MAIL_TRANSPORT === "smtp" ? createSmtp() : null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
    private readonly events: EventsService,
  ) {}

  onModuleInit() {
    if (this.smtp) {
      const where = `${env.SMTP_URL}${env.SMTP_USER ? ` as ${env.SMTP_USER}` : ""}`;
      this.smtp.verify().then(
        () => mailLog.info(`SMTP ready: ${where}${env.MAIL_REDIRECT_TO ? ` (all mail redirected to ${env.MAIL_REDIRECT_TO})` : ""}`),
        (e) => this.log.error(`SMTP check failed for ${where}: ${String(e)}`),
      );
    }
    this.timer = setInterval(() => void this.tick(), 2000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
    this.smtp?.close();
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.renderPending();
      await this.deliverPending();
    } catch (e) {
      this.log.warn(`tick failed: ${String(e)}`);
    } finally {
      this.busy = false;
    }
  }

  /** invoice.render: frozen versions of our own invoices without stored bytes. */
  private async renderPending() {
    const pending = await this.prisma.invoiceVersion.findMany({
      where: { frozenAt: { not: null }, file: null, invoice: { source: "paypure" } },
      select: { id: true },
      take: 20,
    });
    for (const v of pending) {
      const f = this.renderFailures.get(v.id);
      if (f && f.next > Date.now()) continue;
      try {
        await this.pdf.ensureStored(v.id);
        this.renderFailures.delete(v.id);
      } catch (e) {
        const n = (f?.n ?? 0) + 1;
        this.renderFailures.set(v.id, { n, next: Date.now() + Math.min(300_000, 2000 * 2 ** n) });
        this.log.warn(`render ${v.id} failed (${n}): ${String(e).slice(0, 200)}`);
      }
    }
  }

  private async deliverPending() {
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM outbound_emails WHERE status IN ('queued', 'waiting_for_pdf')
      ORDER BY queued_at LIMIT 5`;
    for (const { id } of ids) await this.deliver(id);
  }

  private async deliver(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM outbound_emails WHERE id = ${id}::uuid AND status IN ('queued', 'waiting_for_pdf')
        FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return;
      const email = await tx.outboundEmail.findUniqueOrThrow({ where: { id } });
      const attachments: { name: string; bytes: number; sha256: string }[] = [];
      const files: { filename: string; content: Buffer; contentType: string }[] = [];
      const needsPdf = ["invoice", "correction", "reminder", "test"].includes(email.kind) && email.versionId;
      try {
        if (needsPdf && email.versionId) {
          const version = await tx.invoiceVersion.findUniqueOrThrow({
            where: { id: email.versionId },
            include: { invoice: { select: { number: true } }, file: { select: { sha256: true, bytes: true, pdf: true } } },
          });
          let file = version.file;
          if (email.kind === "test") {
            const bytes = await this.pdf.renderVersion(email.versionId, { watermark: true });
            file = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, pdf: new Uint8Array(bytes) };
          } else if (!file) {
            // Wait for invoice.render (state waiting_for_pdf).
            await tx.outboundEmail.update({
              where: { id },
              data: { status: "waiting_for_pdf", attempts: { increment: 1 }, lastError: "Waiting for the PDF" },
            });
            if (email.attempts + 1 >= MAX_ATTEMPTS * 6) throw new Error("PDF was not rendered");
            return;
          }
          const name = `${version.invoice.number ?? "draft"}${version.rev > 1 ? `-rev${version.rev}` : ""}.pdf`;
          attachments.push({ name, bytes: file.bytes, sha256: file.sha256 });
          files.push({ filename: name, content: Buffer.from(file.pdf), contentType: "application/pdf" });
        }
        const messageId = `<${email.id}@paypure>`;
        if (env.MAIL_TRANSPORT === "log") {
          mailLog.info(
            {
              email_id: email.id,
              kind: email.kind,
              invoice: email.invoiceId,
              version: email.versionId,
              message_id: messageId,
              from: email.from,
              reply_to: email.replyTo,
              to: email.to,
              cc: email.cc,
              subject: email.subject,
              text: email.textBody,
              html: email.htmlBody,
              attachments,
            },
            "email delivered (log transport)",
          );
        } else if (this.smtp) {
          const redirect = env.MAIL_REDIRECT_TO;
          const info = await this.smtp.sendMail({
            messageId,
            from: email.from,
            replyTo: email.replyTo || undefined,
            to: redirect ? [redirect] : email.to,
            cc: redirect ? [] : email.cc,
            subject: email.subject,
            text: email.textBody,
            html: email.htmlBody,
            attachments: files,
            headers: redirect ? { "X-Original-To": [...email.to, ...email.cc].join(", ") } : {},
          });
          if (info.rejected?.length) throw new Error(`Rejected by the server: ${info.rejected.join(", ")}`);
          mailLog.info({ email_id: email.id, kind: email.kind, to: redirect ?? email.to, response: info.response }, "email delivered (smtp)");
        }
        await tx.outboundEmail.update({
          where: { id },
          data: { status: "sent", sentAt: new Date(), transport: env.MAIL_TRANSPORT, messageId, attachments, lastError: null },
        });
      } catch (e) {
        const attempts = email.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS || String(e).includes("PDF was not rendered");
        await tx.outboundEmail.update({
          where: { id },
          data: { status: failed ? "failed" : "queued", attempts, lastError: String(e).slice(0, 500) },
        });
        if (failed && email.invoiceId) {
          await tx.invoiceActivity.create({
            data: { invoiceId: email.invoiceId, kind: "email_failed", actor: "system", data: { emailId: id, error: String(e).slice(0, 200) } },
          });
        }
      }
      if (email.invoiceId) {
        await this.events.emit(tx, { ws: email.workspaceId, topic: "invoice", action: "email", entity: email.invoiceId });
      }
    });
  }
}
