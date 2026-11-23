import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { env } from "../env";
import { PrismaService } from "../prisma.service";
import { TEMPLATE_VERSION } from "./invoice-ops";

/** Signed print URLs (Tech §5.5): the signature is required, but not treated as enough alone. */
export function signPrint(versionId: string, exp: number, wm: boolean): string {
  return createHmac("sha256", env.PRINT_SIGNING_SECRET).update(`${versionId}.${exp}.${wm ? 1 : 0}`).digest("hex");
}

export function verifyPrint(versionId: string, exp: number, wm: boolean, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = Buffer.from(signPrint(versionId, exp, wm));
  const given = Buffer.from(sig ?? "");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Gotenberg renders the same HTML sheet the user sees (T3). A frozen version's PDF is rendered
 * once, stored with its sha256 and never re-rendered (08 §3.2, L8).
 */
@Injectable()
export class PdfService {
  private readonly log = new Logger("pdf");

  constructor(private readonly prisma: PrismaService) {}

  async renderVersion(versionId: string, opts: { watermark?: boolean } = {}): Promise<Buffer> {
    if (!env.GOTENBERG_URL) throw new Error("GOTENBERG_URL is not set");
    const exp = Math.floor(Date.now() / 1000) + 120;
    const wm = !!opts.watermark;
    const url = `${env.CLIENT_INTERNAL_URL}/print/invoice-versions/${versionId}?exp=${exp}&wm=${wm ? 1 : 0}&sig=${signPrint(versionId, exp, wm)}`;
    const form = new FormData();
    form.append("url", url);
    form.append("paperWidth", "8.27");
    form.append("paperHeight", "11.7");
    form.append("marginTop", "0.4");
    form.append("marginBottom", "0.6");
    form.append("marginLeft", "0.4");
    form.append("marginRight", "0.4");
    form.append("printBackground", "true");
    form.append("preferCssPageSize", "false");
    form.append("waitForExpression", "window.__sheetReady === true");
    form.append("failOnHttpStatusCodes", "[499,599]");
    const res = await fetch(`${env.GOTENBERG_URL}/forms/chromium/convert/url`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Gotenberg ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Store the PDF of a frozen version once (idempotent: version_id is the PK). */
  async ensureStored(versionId: string): Promise<boolean> {
    const existing = await this.prisma.invoiceFile.findUnique({ where: { versionId }, select: { versionId: true } });
    if (existing) return true;
    const bytes = await this.renderVersion(versionId);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await this.prisma.invoiceFile
      .create({ data: { versionId, pdf: new Uint8Array(bytes), sha256, bytes: bytes.length, templateVersion: TEMPLATE_VERSION } })
      .catch((e) => {
        if (!String(e).includes("Unique constraint")) throw e;
      });
    this.log.log(`stored PDF for version ${versionId} (${bytes.length} bytes, ${sha256.slice(0, 12)})`);
    return true;
  }

  async storedOrRender(versionId: string): Promise<Buffer> {
    await this.ensureStored(versionId);
    const f = await this.prisma.invoiceFile.findUniqueOrThrow({ where: { versionId } });
    return Buffer.from(f.pdf);
  }
}
