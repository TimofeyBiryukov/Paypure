import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { todayIn } from "@paypure/domain";
import type { PrismaClient } from "../generated/prisma/client";
import { readPayments, readTimeLog } from "./csv";
import { loadPlan } from "./load";
import { parseInvoiceText, pdfText } from "./pdf";
import { buildPlan, type Overrides, type PdfSource } from "./plan";

/**
 * `cli import:paydirt` (docs/paypure/05 §4). Input folder layout, as Paydirt exports it plus two
 * hand-kept files:
 *   *_time_logs.csv
 *   invoices/<client-slug>/invoice_NNN.pdf
 *   paydirt-payments.csv      number,status,paid_on,amount,note
 *   paydirt-overrides.json    time zone, next number, holes, client emails/active, stale rule
 * Returns false when the checks fail (nothing is written).
 */
export async function importPaydirt(
  prisma: PrismaClient,
  o: { dir: string; dryRun: boolean; allowStale: boolean; adminEmail?: string; adminName?: string },
): Promise<boolean> {
  const files = readdirSync(o.dir);
  const log = files.filter((f) => f.endsWith("_time_logs.csv"));
  if (log.length !== 1) throw new Error(`expected one *_time_logs.csv in ${o.dir}, found ${log.length}`);
  const overrides = JSON.parse(readFileSync(join(o.dir, "paydirt-overrides.json"), "utf8")) as Overrides;
  const rows = readTimeLog(readFileSync(join(o.dir, log[0]), "utf8"));
  const payments = readPayments(readFileSync(join(o.dir, "paydirt-payments.csv"), "utf8"));

  const pdfs: PdfSource[] = [];
  const invDir = join(o.dir, "invoices");
  for (const folder of readdirSync(invDir).sort()) {
    for (const f of readdirSync(join(invDir, folder)).sort()) {
      const m = /^invoice_(\d+)\.pdf$/.exec(f);
      if (!m) throw new Error(`unexpected file invoices/${folder}/${f}`);
      const path = join(invDir, folder, f);
      pdfs.push({ folder, path, invoice: parseInvoiceText(pdfText(path), m[1]) });
    }
  }

  const plan = buildPlan({ rows, pdfs, payments, overrides, today: todayIn(overrides.timeZone) });
  if (o.allowStale) {
    const stale = plan.errors.filter((e) => e.includes("Export the time log again"));
    plan.errors = plan.errors.filter((e) => !stale.includes(e));
    plan.warnings.push(...stale.map((e) => `(allowed by --allow-stale) ${e}`));
  }

  console.log(plan.report.join("\n"));
  console.log();
  for (const w of plan.warnings) console.log(`WARN   ${w}`);
  for (const e of plan.errors) console.log(`ERROR  ${e}`);
  if (plan.errors.length) {
    console.log(`\n${plan.errors.length} error(s). Nothing was imported.`);
    return false;
  }
  if (o.dryRun) {
    console.log("\nChecks passed. Dry run: nothing was written.");
    return true;
  }
  const started = Date.now();
  const r = await loadPlan(prisma, plan, { email: o.adminEmail as string, name: o.adminName });
  console.log(`\nImported into workspace ${r.workspaceId} in ${((Date.now() - started) / 1000).toFixed(1)} s, and verified against the plan.`);
  console.log(`One-time link to set the admin password:\n${r.inviteUrl}`);
  return true;
}
