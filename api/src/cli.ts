/**
 * Admin CLI (Tech §5.3). No self-signup in v1:
 *   docker compose exec api pnpm --filter api cli workspace:create --name "Northwind" --admin-email you@example.com
 *   docker compose exec api pnpm --filter api cli seed:demo
 */
import { createHash, randomBytes } from "node:crypto";
import { addDays, fromWallTime, todayIn, toLocalDate } from "@paypure/domain";
import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import { PrismaClient } from "./generated/prisma/client";
import { DEFAULT_TEMPLATES } from "./modules/invoice-ops";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }),
});

function args() {
  const out: Record<string, string> = {};
  const a = process.argv.slice(3);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith("--"))
      out[a[i].slice(2)] = a[i + 1]?.startsWith("--") || a[i + 1] === undefined ? "true" : a[++i];
  }
  return out;
}

async function createWorkspace(o: {
  name: string;
  adminEmail: string;
  adminName?: string;
  currency?: string;
  tz?: string;
  format?: string;
  reset?: "never" | "yearly";
  next?: number;
  password?: string;
}) {
  const tz = o.tz ?? "Europe/Berlin";
  const ws = await prisma.workspace.create({
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
    await prisma.emailTemplate.create({
      data: {
        workspaceId: ws.id,
        kind: kind as keyof typeof DEFAULT_TEMPLATES,
        subject: t.subject,
        body: t.body,
      },
    });
  }
  if (o.next) {
    const period = (o.reset ?? "yearly") === "yearly" ? todayIn(tz).slice(0, 4) : "";
    await prisma.invoiceSequence.create({ data: { workspaceId: ws.id, period, nextSeq: o.next } });
  }
  const token = randomBytes(32).toString("base64url");
  const admin = await prisma.member.create({
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
  return {
    ws,
    admin,
    inviteUrl: `${process.env.PUBLIC_URL ?? "http://localhost:3000"}/invite/${token}`,
  };
}

async function seedDemo() {
  const existing = await prisma.member.findFirst({ where: { email: "admin@example.com" } });
  if (existing) {
    console.log("Demo workspace already exists. Sign in as admin@example.com / paypure-demo");
    return;
  }
  const tz = "Europe/Berlin";
  // Our workspace continues Paydirt's sequence: {seq:3}, never reset, next 188 (D9).
  const { ws, admin } = await createWorkspace({
    name: "Northwind Studio",
    adminEmail: "admin@example.com",
    adminName: "Jane Doe",
    currency: "EUR",
    tz,
    format: "{seq:3}",
    reset: "never",
    next: 188,
    password: "paypure-demo",
  });
  await prisma.workspace.update({
    where: { id: ws.id },
    data: {
      senderName: "Jane Doe",
      address: "Hauptstraße 1\n10115 Berlin\nGermany",
      phone: "+49 30 1234567",
      taxId: "DE123456789",
      billingEmail: "billing@northwind.example",
      defaultRateMinor: 9000,
      defaultTermsDays: 14,
    },
  });
  const member = await prisma.member.create({
    data: {
      workspaceId: ws.id,
      name: "Sam Lee",
      email: "member@example.com",
      role: "member",
      status: "active",
      timeZone: tz,
      passwordHash: await argon2.hash("paypure-demo", { type: argon2.argon2id }),
    },
  });
  await prisma.paymentAccount.create({
    data: {
      workspaceId: ws.id,
      currency: "USD",
      label: "Mercury USD",
      beneficiaryName: "Northwind Studio",
      beneficiaryAddress: "Hauptstraße 1, 10115 Berlin, Germany",
      bankName: "Example Bank N.A.",
      bankAddress: "1 Example Plaza, New York, NY",
      accountNumber: "000123456789",
      routingNumber: "021000021",
      swiftBic: "EXAMUS33",
      correspondentBankName: "Intermediary Bank",
      correspondentAccount: "987654321",
      correspondentSwift: "INTRUS33",
      instructions: "Leave the reference and comment fields empty.",
      isDefault: true,
    },
  });
  await prisma.paymentAccount.create({
    data: {
      workspaceId: ws.id,
      currency: "EUR",
      label: "Sparkasse EUR",
      beneficiaryName: "Northwind Studio",
      bankName: "Example Sparkasse",
      iban: "DE89370400440532013000",
      swiftBic: "COBADEFFXXX",
      isDefault: true,
    },
  });
  const acme = await prisma.client.create({
    data: {
      workspaceId: ws.id,
      name: "Acme Co",
      contactName: "Wile E. Coyote",
      billingEmails: ["jane@acme.example"],
      address: "1 Desert Road\nTucson, AZ 85701\nUSA",
      currency: "USD",
      rateMinor: 6000,
      colour: 0,
      termsDays: 14,
    },
  });
  const globex = await prisma.client.create({
    data: {
      workspaceId: ws.id,
      name: "Globex",
      contactName: "Hank Scorpio",
      billingEmails: ["ap@globex.example"],
      address: "Cypress Creek 1\nUSA",
      currency: "EUR",
      colour: 1,
    },
  });
  const initech = await prisma.client.create({
    data: {
      workspaceId: ws.id,
      name: "Initech",
      contactName: "Bill Lumbergh",
      billingEmails: ["bill@initech.example"],
      address: "4120 Freidrich Ln\nAustin, TX",
      currency: "USD",
      rateMinor: 3250,
      colour: 2,
    },
  });
  const mk = async (
    clientId: string,
    name: string,
    tasks: {
      name: string;
      mode?: "hourly" | "fixed" | "non_billable";
      fixed?: number;
      rate?: number;
    }[],
    rate?: number,
    budget?: { kind: "hours" | "money"; value: number },
  ) => {
    const p = await prisma.project.create({
      data: {
        workspaceId: ws.id,
        clientId,
        name,
        rateMinor: rate ?? null,
        budgetKind: budget?.kind ?? null,
        budgetValue: budget?.value ?? null,
      },
    });
    const ts = [];
    let pos = 0;
    for (const t of tasks) {
      ts.push(
        await prisma.task.create({
          data: {
            workspaceId: ws.id,
            projectId: p.id,
            name: t.name,
            billingMode: t.mode ?? "hourly",
            fixedAmountMinor: t.mode === "fixed" ? t.fixed : null,
            rateMinor: t.rate ?? null,
            position: pos++,
          },
        }),
      );
    }
    return ts;
  };
  const [design, dev, meetings] = await mk(
    acme.id,
    "Website",
    [
      { name: "Design" },
      { name: "Development" },
      { name: "Internal meetings", mode: "non_billable" },
    ],
    undefined,
    { kind: "money", value: 500000 },
  );
  const [logo] = await mk(acme.id, "Brand refresh", [
    { name: "Logo design", mode: "fixed", fixed: 120000 },
  ]);
  const [api, support] = await mk(
    globex.id,
    "Platform API",
    [{ name: "Backend" }, { name: "Support", rate: 7500 }],
    9500,
    { kind: "hours", value: 100 * 3600 },
  );
  const [legacy] = await mk(initech.id, "TPS reports", [{ name: "Maintenance" }]);

  const today = todayIn(tz);
  const notes = [
    "Went through homepage comps with Jane",
    "- Fixed navigation bug\n- Reviewed PR #42\n- Deployed to staging",
    "Client call about the checkout flow",
    "",
    "Refactored the auth module, added tests",
    "Wireframes for the pricing page",
  ];
  let n = 0;
  const entry = async (
    memberId: string,
    taskId: string,
    date: string,
    from: string,
    to: string,
    note: string,
    pauses: [string, string][] = [],
  ) => {
    const start = fromWallTime(date, from, tz);
    const end = fromWallTime(date, to, tz);
    if (!start.ok || !end.ok) return;
    const bounds: [Date, Date][] = [];
    let cur = start.instant;
    for (const [ps, pe] of pauses) {
      const a = fromWallTime(date, ps, tz);
      const b = fromWallTime(date, pe, tz);
      if (a.ok && b.ok) {
        bounds.push([cur, a.instant]);
        cur = b.instant;
      }
    }
    bounds.push([cur, end.instant]);
    const dur = bounds.reduce((s, [a, b]) => s + (b.getTime() - a.getTime()) / 1000, 0);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    await prisma.timeEntry.create({
      data: {
        workspaceId: ws.id,
        memberId,
        taskId,
        state: "stopped",
        timeZone: tz,
        date: new Date(`${toLocalDate(start.instant, tz)}T00:00:00Z`),
        startedAt: start.instant,
        endedAt: end.instant,
        durationSeconds: Math.round(dur),
        note,
        billable: task.billingMode === "hourly",
        segments: {
          create: bounds.map(([a, b]) => ({ workspaceId: ws.id, startedAt: a, endedAt: b })),
        },
      },
    });
    n++;
  };
  // Five weeks of work, weekdays only, with a lunch break on some days.
  for (let d = -35; d <= 0; d++) {
    const date = addDays(today, d);
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const i = d + 40;
    await entry(
      admin.id,
      [design.id, dev.id, api.id][i % 3],
      date,
      "09:00",
      "12:30",
      notes[i % notes.length],
      i % 2 ? [["10:40", "10:55"]] : [],
    );
    if (d === 0) continue; // leave today's afternoon as a gap to fill
    await entry(
      admin.id,
      [dev.id, support.id, legacy.id, logo.id][i % 4],
      date,
      "13:15",
      i % 5 === 0 ? "16:00" : "17:40",
      notes[(i + 2) % notes.length],
    );
    if (i % 4 === 0) await entry(member.id, meetings.id, date, "10:00", "10:45", "Weekly sync");
    if (i % 3 === 0)
      await entry(member.id, design.id, date, "11:00", "15:30", notes[(i + 1) % notes.length], [
        ["12:30", "13:00"],
      ]);
  }
  // Stale time from long ago (F8: clearing stale unbilled time).
  await entry(
    admin.id,
    legacy.id,
    addDays(today, -400),
    "09:00",
    "11:30",
    "Old maintenance work never invoiced",
  );

  console.log(`Demo workspace ready with ${n} time entries.
  Admin:  admin@example.com / paypure-demo
  Member: member@example.com / paypure-demo
  Next invoice number: 188`);
}

async function main() {
  const cmd = process.argv[2];
  const a = args();
  if (cmd === "workspace:create") {
    if (!a.name || !a["admin-email"]) {
      console.error(
        "Usage: workspace:create --name <name> --admin-email <email> [--currency EUR] [--tz Europe/Berlin] [--format {seq:3}] [--reset never] [--next 188]",
      );
      process.exit(1);
    }
    const r = await createWorkspace({
      name: a.name,
      adminEmail: a["admin-email"],
      adminName: a["admin-name"],
      currency: a.currency,
      tz: a.tz,
      format: a.format,
      reset: a.reset as "never" | "yearly" | undefined,
      next: a.next ? Number(a.next) : undefined,
    });
    console.log(
      `Workspace "${r.ws.name}" created. One-time invite link for ${r.admin.email}:\n${r.inviteUrl}`,
    );
  } else if (cmd === "seed:demo") {
    await seedDemo();
  } else {
    console.error("Commands: workspace:create, seed:demo");
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
