import { Controller, Get, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import { displayStatus, todayIn } from "@paypure/domain";
import type { FastifyReply } from "fastify";
import { Public } from "../common/auth";
import { d2s } from "../common/dates";
import { ApiError, notFound } from "../common/errors";
import { PrismaService } from "../prisma.service";
import { EventsService } from "./events";
import { buildSheet, versionInclude } from "./invoice-ops";
import { PdfService, verifyPrint } from "./pdf";

/** Client-facing invoice page data (S15) and the signed print route's data (Tech §5.5). */
@Public()
@Controller("v1")
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly pdf: PdfService,
  ) {}

  private async byToken(token: string) {
    const inv = await this.prisma.invoice.findUnique({
      where: { publicToken: token },
      include: {
        client: true,
        currentVersion: { include: versionInclude },
        versions: { where: { frozenAt: { not: null } }, orderBy: { rev: "desc" } },
        payments: { where: { deletedAt: null }, orderBy: { receivedOn: "asc" } },
      },
    });
    // Drafts are never public.
    if (!inv || inv.status === "draft" || !inv.currentVersion) throw notFound("This invoice link isn't valid.");
    return inv;
  }

  @Get("public/invoices/:token")
  async view(@Param("token") token: string) {
    const inv = await this.byToken(token);
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: inv.workspaceId } });
    const sheet = await this.prisma.$transaction((tx) => buildSheet(tx, ws, inv, inv.currentVersion!));
    const netPaid = inv.payments.reduce((s, p) => s + (p.kind === "payment" ? p.amount : -p.amount), 0);
    const status = displayStatus({
      status: inv.status,
      totalMinor: inv.currentVersion?.total ?? 0,
      netPaidMinor: netPaid,
      dueDate: d2s(inv.currentVersion?.dueDate),
      today: todayIn(ws.timeZone),
    });
    return {
      sheet,
      status,
      voided: inv.status === "void",
      businessName: ws.businessName || ws.name,
      payments: inv.payments.map((p) => ({ kind: p.kind, amountMinor: p.amount, receivedOn: d2s(p.receivedOn) })),
      versions: inv.versions.map((v) => ({ id: v.id, rev: v.rev, frozenAt: v.frozenAt?.toISOString(), changeSummary: v.changeSummary })),
    };
  }

  /** "Viewed" is logged by a beacon after 2 s visible, never by the GET (08 §10). */
  @Post("public/invoices/:token/viewed")
  @HttpCode(204)
  async viewed(@Param("token") token: string) {
    const inv = await this.byToken(token);
    const last = await this.prisma.invoiceActivity.findFirst({
      where: { invoiceId: inv.id, kind: "viewed" },
      orderBy: { at: "desc" },
    });
    if (last && Date.now() - last.at.getTime() < 30 * 60_000) return;
    await this.prisma.$transaction(async (tx) => {
      const count = await tx.invoiceActivity.count({ where: { invoiceId: inv.id, kind: "viewed" } });
      await tx.invoiceActivity.create({
        data: { invoiceId: inv.id, versionId: inv.currentVersionId, kind: "viewed", actor: "client", data: { rev: inv.currentVersion?.rev, count: count + 1 } },
      });
      await this.events.emit(tx, { ws: inv.workspaceId, topic: "invoice", action: "viewed", entity: inv.id });
    });
  }

  @Get("public/invoices/:token/pdf")
  async pdfDownload(@Param("token") token: string, @Query("version") versionId: string | undefined, @Res() reply: FastifyReply) {
    const inv = await this.byToken(token);
    const vid = versionId && inv.versions.some((v) => v.id === versionId) ? versionId : inv.currentVersionId!;
    const bytes = await this.pdf.storedOrRender(vid);
    const v = inv.versions.find((x) => x.id === vid);
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `inline; filename="${inv.number}${v && v.rev > 1 ? `-rev${v.rev}` : ""}.pdf"`)
      .send(bytes);
  }

  @Get("print/versions/:id")
  async print(@Param("id") id: string, @Query("exp") exp: string, @Query("wm") wm: string, @Query("sig") sig: string) {
    if (!verifyPrint(id, Number(exp), wm === "1", sig)) throw new ApiError(403, "bad_signature", "Invalid print signature.");
    const v = await this.prisma.invoiceVersion.findUnique({ where: { id }, include: { ...versionInclude, invoice: { include: { client: true } } } });
    if (!v) throw notFound();
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: v.invoice.workspaceId } });
    return this.prisma.$transaction((tx) => buildSheet(tx, ws, v.invoice, v, { watermark: wm === "1" }));
  }
}
