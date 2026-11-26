import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DEFAULT_LAYOUT } from "@paypure/domain";
import { s2d } from "../common/dates";
import type { PrismaClient } from "../generated/prisma/client";
import { newPublicToken } from "../modules/invoice-ops";
import type { Prisma, Tx } from "../prisma.service";
import { createWorkspace } from "../workspace";
import type { Plan } from "./plan";

/**
 * Write a checked plan into a new workspace, in one transaction (docs/paypure/05 §4.2).
 * Order matters because of the immutability triggers (08 §3.3):
 * - entries and their segments go in unclaimed; claims are set afterwards (the billed guard
 *   blocks segment inserts on an entry billed on an issued invoice);
 * - each version gets its lines while open, then is frozen;
 * - imported versions never get line–entry links (08 §9), and keep the original PDF.
 */
export async function loadPlan(prisma: PrismaClient, plan: Plan, admin: { email: string; name?: string }) {
  const email = admin.email.toLowerCase();
  if (await prisma.member.findFirst({ where: { email } })) {
    throw new Error(`${email} already belongs to a workspace. The import creates a new one; use another email or remove the old workspace first`);
  }
  const pdfBytes = new Map(plan.invoices.map((i) => [i.number, readFileSync(i.pdfPath)]));

  return prisma.$transaction(
    async (tx) => {
      const { ws, admin: member, inviteUrl } = await createWorkspace(tx, {
        name: plan.profile.businessName,
        adminEmail: email,
        adminName: admin.name ?? plan.profile.senderName,
        currency: "USD",
        tz: plan.timeZone,
        format: "{seq:3}",
        reset: "never",
        next: plan.nextNumber,
      });
      await tx.workspace.update({
        where: { id: ws.id },
        data: {
          senderName: plan.profile.senderName,
          address: plan.profile.address,
          phone: plan.profile.phone,
          billingEmail: plan.profile.email,
          defaultTermsDays: 7,
        },
      });
      const a = plan.account;
      await tx.paymentAccount.create({
        data: {
          workspaceId: ws.id,
          currency: a.currency,
          label: a.label,
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
          isDefault: true,
        },
      });

      // Catalog
      const now = new Date();
      const clientId = new Map<string, string>();
      for (const c of plan.clients) {
        const row = await tx.client.create({
          data: {
            workspaceId: ws.id,
            name: c.name,
            contactName: c.contactName,
            address: c.address,
            billingEmails: c.billingEmails,
            currency: c.currency,
            termsDays: c.termsDays,
            colour: c.colour,
            lineLayout: DEFAULT_LAYOUT as unknown as Prisma.InputJsonValue,
            archivedAt: c.archived ? now : null,
          },
        });
        clientId.set(c.key, row.id);
      }
      const projectId = new Map<string, string>();
      for (const p of plan.projects) {
        const row = await tx.project.create({
          data: { workspaceId: ws.id, clientId: clientId.get(p.clientKey) as string, name: p.name, rateMinor: p.rateMinor, status: p.completed ? "completed" : "active" },
        });
        projectId.set(p.key, row.id);
      }
      const taskId = new Map<string, string>();
      for (const t of plan.tasks) {
        const row = await tx.task.create({
          data: {
            workspaceId: ws.id,
            projectId: projectId.get(t.projectKey) as string,
            name: t.name,
            billingMode: t.billingMode,
            rateMinor: t.rateMinor,
            position: t.position,
            doneAt: t.doneOn ? new Date(`${t.doneOn}T12:00:00Z`) : null,
          },
        });
        taskId.set(t.key, row.id);
      }

      // Entries and segments, unclaimed
      const entryIds = plan.entries.map(() => randomUUID());
      const chunk = <T>(xs: T[], n = 1000) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
      for (const part of chunk(plan.entries.map((e, i) => ({ e, id: entryIds[i] })))) {
        await tx.timeEntry.createMany({
          data: part.map(({ e, id }) => ({
            id,
            workspaceId: ws.id,
            memberId: member.id,
            taskId: taskId.get(e.taskKey) as string,
            state: "stopped" as const,
            timeZone: plan.timeZone,
            date: s2d(e.date),
            startedAt: e.startedAt,
            endedAt: e.endedAt,
            durationSeconds: e.durationSeconds,
            note: e.note,
            billable: e.billable,
            offInvoice: e.off?.kind ?? null,
            offInvoiceRef: e.off?.ref ?? null,
            offInvoiceNote: e.off?.note ?? null,
          })),
        });
        const segs = part.filter(({ e }) => e.startedAt && e.endedAt);
        if (segs.length) {
          await tx.timeEntrySegment.createMany({
            data: segs.map(({ e, id }) => ({ workspaceId: ws.id, timeEntryId: id, startedAt: e.startedAt as Date, endedAt: e.endedAt as Date })),
          });
        }
      }

      // Invoices: issued, frozen rev 1, original PDF, payment
      const invoiceId = new Map<string, string>();
      for (const inv of plan.invoices) {
        const issuedAt = new Date(`${inv.issueDate}T12:00:00Z`);
        const row = await tx.invoice.create({
          data: {
            workspaceId: ws.id,
            clientId: clientId.get(inv.clientKey) as string,
            status: "issued",
            number: inv.number,
            numberSeq: inv.seq,
            numberPeriod: "",
            currency: inv.currency,
            publicToken: newPublicToken(),
            source: "paydirt",
            createdAt: issuedAt,
          },
        });
        invoiceId.set(inv.number, row.id);
        const v = await tx.invoiceVersion.create({
          data: {
            invoiceId: row.id,
            rev: 1,
            issueDate: s2d(inv.issueDate),
            dueDate: s2d(inv.dueDate),
            termsDays: inv.termsDays,
            summary: inv.summary,
            fromSnapshot: inv.from as unknown as Prisma.InputJsonValue,
            toSnapshot: inv.to as unknown as Prisma.InputJsonValue,
            paymentAccountMode: inv.account ? "default" : "none",
            paymentAccountSnapshot: (inv.account ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
            lineLayout: DEFAULT_LAYOUT as unknown as Prisma.InputJsonValue,
            subtotal: inv.totalMinor,
            discountTotal: 0,
            taxTotal: 0,
            total: inv.totalMinor,
            createdAt: issuedAt,
          },
        });
        await tx.invoiceLine.createMany({
          data: inv.lines.map((l, i) => ({
            versionId: v.id,
            position: i,
            kind: l.kind,
            title: l.title,
            detail: l.detail,
            qtyHundredths: l.qtyHundredths,
            unit: l.unit,
            rateMinor: l.rateMinor,
            amountMinor: l.amountMinor,
            taskId: l.taskKey ? (taskId.get(l.taskKey) as string) : null,
          })),
        });
        const pdf = pdfBytes.get(inv.number) as Buffer;
        const sha256 = createHash("sha256").update(pdf).digest("hex");
        await tx.invoiceVersion.update({
          where: { id: v.id },
          data: { frozenAt: issuedAt, frozenBy: member.id, contentHash: sha256, templateVersion: "paydirt" },
        });
        await tx.invoice.update({ where: { id: row.id }, data: { currentVersionId: v.id } });
        await tx.invoiceFile.create({
          data: { versionId: v.id, kind: "imported_original", pdf: new Uint8Array(pdf), sha256, bytes: pdf.length, templateVersion: "paydirt" },
        });
        await tx.invoiceActivity.create({
          data: { invoiceId: row.id, versionId: v.id, kind: "imported", actor: "system", at: issuedAt, data: { source: "paydirt", number: inv.number } },
        });
        if (inv.payment) {
          const paidAt = new Date(`${inv.payment.paidOn}T12:00:00Z`);
          const p = await tx.payment.create({
            data: {
              invoiceId: row.id,
              amount: inv.payment.amountMinor,
              receivedOn: s2d(inv.payment.paidOn),
              note: inv.payment.note,
              createdBy: member.id,
              createdAt: paidAt,
            },
          });
          await tx.invoiceActivity.create({
            data: { invoiceId: row.id, kind: "payment_recorded", actor: "system", at: paidAt, data: { amountMinor: p.amount, receivedOn: inv.payment.paidOn, paymentId: p.id } },
          });
          await tx.invoiceActivity.create({ data: { invoiceId: row.id, kind: "paid", actor: "system", at: paidAt, data: { on: inv.payment.paidOn } } });
        }
      }

      // Claims, now that the invoices exist
      const claims = new Map<string, string[]>();
      plan.entries.forEach((e, i) => {
        if (e.invoiceNumber) claims.set(e.invoiceNumber, [...(claims.get(e.invoiceNumber) ?? []), entryIds[i]]);
      });
      for (const [n, ids] of claims) {
        await tx.timeEntry.updateMany({ where: { id: { in: ids } }, data: { invoiceId: invoiceId.get(n) as string } });
      }

      await verify(tx, ws.id, plan);
      return { workspaceId: ws.id, inviteUrl };
    },
    { timeout: 15 * 60_000, maxWait: 30_000 },
  );
}

/** Read the import back and compare it with the plan; any difference rolls everything back. */
async function verify(tx: Tx, workspaceId: string, plan: Plan) {
  const problems: string[] = [];
  const eq = (what: string, got: unknown, want: unknown) => {
    if (String(got) !== String(want)) problems.push(`${what}: database has ${got}, plan has ${want}`);
  };
  const [counts] = await tx.$queryRaw<{ entries: bigint; seconds: bigint; claimed: bigint; off: bigint; invoices: bigint; lines: bigint; files: bigint; frozen: bigint }[]>`
    SELECT
      (SELECT count(*) FROM time_entries WHERE workspace_id = ${workspaceId}::uuid) AS entries,
      (SELECT coalesce(sum(duration_seconds), 0) FROM time_entries WHERE workspace_id = ${workspaceId}::uuid) AS seconds,
      (SELECT count(*) FROM time_entries WHERE workspace_id = ${workspaceId}::uuid AND invoice_id IS NOT NULL) AS claimed,
      (SELECT count(*) FROM time_entries WHERE workspace_id = ${workspaceId}::uuid AND off_invoice IS NOT NULL) AS off,
      (SELECT count(*) FROM invoices WHERE workspace_id = ${workspaceId}::uuid) AS invoices,
      (SELECT count(*) FROM invoice_lines l JOIN invoice_versions v ON v.id = l.version_id JOIN invoices i ON i.id = v.invoice_id WHERE i.workspace_id = ${workspaceId}::uuid) AS lines,
      (SELECT count(*) FROM invoice_files f JOIN invoice_versions v ON v.id = f.version_id JOIN invoices i ON i.id = v.invoice_id WHERE i.workspace_id = ${workspaceId}::uuid) AS files,
      (SELECT count(*) FROM invoice_versions v JOIN invoices i ON i.id = v.invoice_id WHERE i.workspace_id = ${workspaceId}::uuid AND v.frozen_at IS NOT NULL) AS frozen`;
  eq("entries", counts.entries, plan.entries.length);
  eq("seconds", counts.seconds, plan.entries.reduce((s, e) => s + e.durationSeconds, 0));
  eq("claimed entries", counts.claimed, plan.entries.filter((e) => e.invoiceNumber).length);
  eq("written-off entries", counts.off, plan.entries.filter((e) => e.off).length);
  eq("invoices", counts.invoices, plan.invoices.length);
  eq("frozen versions", counts.frozen, plan.invoices.length);
  eq("PDFs", counts.files, plan.invoices.length);
  eq("lines", counts.lines, plan.invoices.reduce((s, i) => s + i.lines.length, 0));

  const totals = await tx.$queryRaw<{ currency: string; total: bigint; line_sum: bigint; paid: bigint }[]>`
    SELECT i.currency, sum(v.total) AS total,
           sum((SELECT sum(amount_minor) FROM invoice_lines WHERE version_id = v.id)) AS line_sum,
           sum((SELECT coalesce(sum(amount), 0) FROM payments WHERE invoice_id = i.id AND deleted_at IS NULL)) AS paid
    FROM invoices i JOIN invoice_versions v ON v.id = i.current_version_id
    WHERE i.workspace_id = ${workspaceId}::uuid GROUP BY i.currency`;
  for (const t of totals) {
    const xs = plan.invoices.filter((i) => i.currency === t.currency);
    eq(`${t.currency} total`, t.total, xs.reduce((s, i) => s + i.totalMinor, 0));
    eq(`${t.currency} lines`, t.line_sum, xs.reduce((s, i) => s + i.totalMinor, 0));
    eq(`${t.currency} paid`, t.paid, xs.reduce((s, i) => s + (i.payment?.amountMinor ?? 0), 0));
  }
  const [cross] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM time_entries e JOIN tasks t ON t.id = e.task_id JOIN projects p ON p.id = t.project_id
    JOIN invoices i ON i.id = e.invoice_id
    WHERE e.workspace_id = ${workspaceId}::uuid AND i.client_id <> p.client_id`;
  eq("entries billed to another client's invoice", cross.n, 0);
  if (problems.length) throw new Error(`verification failed, nothing was imported:\n  ${problems.join("\n  ")}`);
}
