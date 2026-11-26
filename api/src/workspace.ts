import { createHash, randomBytes } from "node:crypto";
import { todayIn } from "@paypure/domain";
import * as argon2 from "argon2";
import { DEFAULT_TEMPLATES } from "./modules/invoice-ops";
import type { Tx } from "./prisma.service";

export interface WorkspaceInput {
  name: string;
  adminEmail: string;
  adminName?: string;
  currency?: string;
  tz?: string;
  format?: string;
  reset?: "never" | "yearly";
  next?: number;
  password?: string;
}

/**
 * A workspace with its email templates, optional sequence start and one admin (Tech §5.3).
 * Without a password the admin is invited: the result carries a one-time link.
 */
export async function createWorkspace(db: Tx, o: WorkspaceInput) {
  const tz = o.tz ?? "Europe/Berlin";
  const ws = await db.workspace.create({
    data: {
      name: o.name,
      businessName: o.name,
      currency: o.currency ?? "EUR",
      timeZone: tz,
      numberFormat: o.format ?? "INV-{YYYY}-{seq:4}",
      numberReset: o.reset ?? "yearly",
    },
  });
  for (const [kind, t] of Object.entries(DEFAULT_TEMPLATES)) {
    await db.emailTemplate.create({ data: { workspaceId: ws.id, kind: kind as keyof typeof DEFAULT_TEMPLATES, subject: t.subject, body: t.body } });
  }
  if (o.next) {
    const period = (o.reset ?? "yearly") === "yearly" ? todayIn(tz).slice(0, 4) : "";
    await db.invoiceSequence.create({ data: { workspaceId: ws.id, period, nextSeq: o.next } });
  }
  const token = randomBytes(32).toString("base64url");
  const admin = await db.member.create({
    data: {
      workspaceId: ws.id,
      name: o.adminName ?? o.adminEmail.split("@")[0],
      email: o.adminEmail.toLowerCase(),
      role: "admin",
      status: o.password ? "active" : "invited",
      timeZone: tz,
      passwordHash: o.password ? await argon2.hash(o.password, { type: argon2.argon2id }) : null,
      inviteToken: o.password ? null : createHash("sha256").update(token).digest("hex"),
    },
  });
  return { ws, admin, inviteUrl: `${process.env.PUBLIC_URL ?? "http://localhost:3000"}/invite/${token}` };
}
