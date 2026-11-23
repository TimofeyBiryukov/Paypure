import { Controller, Get } from "@nestjs/common";
import { addDays, startOfWeek, todayIn } from "@paypure/domain";
import { C, type Ctx } from "../common/auth";
import { d2s, s2d } from "../common/dates";
import { PrismaService } from "../prisma.service";
import { BillingService } from "./billing";

/** Home (S1): "what should I do now?" for both personas. */
@Controller("v1/home")
export class HomeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  @Get()
  async home(@C() ctx: Ctx) {
    const ws = ctx.workspace;
    const today = todayIn(ctx.tz);
    const weekStart = startOfWeek(today, ctx.member.weekStart);
    const lastWeekStart = addDays(weekStart, -7);
    const entries = await this.prisma.timeEntry.findMany({
      where: { memberId: ctx.member.id, deletedAt: null, date: { gte: s2d(lastWeekStart), lte: s2d(addDays(weekStart, 6)) } },
      select: { date: true, durationSeconds: true, state: true, task: { select: { project: { select: { client: { select: { id: true, name: true, colour: true } } } } } } },
    });
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
      const byClient = new Map<string, { name: string; colour: number; seconds: number }>();
      for (const e of entries.filter((x) => d2s(x.date) === d)) {
        const c = e.task?.project.client;
        const key = c?.id ?? "none";
        const cur = byClient.get(key) ?? { name: c?.name ?? "No task", colour: c?.colour ?? 6, seconds: 0 };
        cur.seconds += e.durationSeconds;
        byClient.set(key, cur);
      }
      return { date: d, clients: [...byClient.values()], seconds: [...byClient.values()].reduce((s, c) => s + c.seconds, 0) };
    });
    const thisWeek = days.reduce((s, d) => s + d.seconds, 0);
    const lastWeek = entries.filter((e) => (d2s(e.date) as string) < weekStart).reduce((s, e) => s + e.durationSeconds, 0);
    const memberHasTasks = (await this.prisma.task.count({ where: { workspaceId: ws.id } })) > 0;
    const clientCount = await this.prisma.client.count({ where: { workspaceId: ws.id } });
    const base = {
      today,
      weekStart,
      days,
      thisWeekSeconds: thisWeek,
      lastWeekSeconds: lastWeek,
      firstRun: clientCount === 0,
      memberHasTasks,
      checklist: {
        business: !!ws.businessName,
        client: clientCount > 0,
        time: (await this.prisma.timeEntry.count({ where: { workspaceId: ws.id } })) > 0,
      },
    };
    if (!ctx.isAdmin) return base;

    const tasks = await this.billing.unbilledTasks(ws);
    const rollup = this.billing.rollupByClient(tasks);
    const clients = await this.prisma.client.findMany({
      where: { id: { in: [...rollup.keys()] } },
      select: { id: true, name: true, colour: true, readyThresholdMinor: true, currency: true },
    });
    const staleCutoff = addDays(todayIn(ws.timeZone), -60);
    const ready = [...rollup.values()]
      .map((r) => {
        const c = clients.find((x) => x.id === r.clientId)!;
        const threshold = c.readyThresholdMinor ?? (c.currency === ws.currency ? ws.readyThresholdMinor : null);
        return {
          ...r,
          name: c.name,
          colour: c.colour,
          ready: threshold != null && r.amountMinor >= threshold,
          stale: !!r.since && r.since < staleCutoff,
        };
      })
      .sort((a, b) => b.amountMinor - a.amountMinor);
    const invoices = await this.billing.invoiceSummaries(ws, { status: "issued" });
    const outstanding = invoices.filter((i) => i.balanceMinor > 0);
    const month = todayIn(ws.timeZone).slice(0, 7);
    const group = (xs: typeof invoices, pick: (i: (typeof invoices)[number]) => number) => {
      const m = new Map<string, number>();
      for (const i of xs) m.set(i.currency, (m.get(i.currency) ?? 0) + pick(i));
      return [...m.entries()].map(([currency, minor]) => ({ currency, minor }));
    };
    return {
      ...base,
      ready,
      outstanding: {
        outstanding: group(outstanding, (i) => i.balanceMinor),
        overdue: group(outstanding.filter((i) => i.display.key === "overdue"), (i) => i.balanceMinor),
        paidThisMonth: group(invoices.filter((i) => i.lastPaidOn?.startsWith(month)), (i) => i.netPaidMinor),
        top: outstanding
          .sort((a, b) => (a.display.key === "overdue" ? -1 : 0) - (b.display.key === "overdue" ? -1 : 0) || (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
          .slice(0, 5),
      },
    };
  }
}
