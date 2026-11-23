import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ClientInput, ProjectInput, sumByCurrency, TaskInput, todayIn } from "@paypure/domain";
import { AdminOnly, C, type Ctx } from "../common/auth";
import { d2s } from "../common/dates";
import { conflict, invalid, notFound } from "../common/errors";
import { parse } from "../common/zod";
import { PrismaService } from "../prisma.service";
import { BillingService } from "./billing";
import { EventsService } from "./events";

const MONEY_KEYS = ["rateMinor", "budgetValue", "fixedAmountMinor", "readyThresholdMinor"];

/** Members see no money: removed in the API, not just hidden (Brief §6.1). */
function stripMoney<T extends Record<string, unknown>>(ctx: Ctx, o: T): T {
  if (ctx.isAdmin) return o;
  const copy: Record<string, unknown> = { ...o };
  for (const k of MONEY_KEYS) delete copy[k];
  return copy as T;
}

@Controller("v1")
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly events: EventsService,
  ) {}

  /** Compact list for pickers and the ⌘K palette (Tech §6.2). */
  @Get("catalog")
  async catalog(@C() ctx: Ctx) {
    const tasks = await this.prisma.task.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        doneAt: null,
        project: { status: "active", client: { archivedAt: null } },
      },
      select: {
        id: true,
        name: true,
        billingMode: true,
        project: {
          select: {
            id: true,
            name: true,
            client: { select: { id: true, name: true, colour: true } },
          },
        },
      },
      orderBy: [
        { project: { client: { name: "asc" } } },
        { project: { name: "asc" } },
        { position: "asc" },
      ],
    });
    const recent = await this.prisma.timeEntry.findMany({
      where: { memberId: ctx.member.id, deletedAt: null, taskId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { taskId: true },
      take: 50,
    });
    const recentIds = [...new Set(recent.map((r) => r.taskId))].slice(0, 8);
    const clients = await this.prisma.client.findMany({
      where: { workspaceId: ctx.workspace.id, archivedAt: null },
      select: { id: true, name: true, colour: true },
      orderBy: { name: "asc" },
    });
    return {
      tasks: tasks.map((t) => ({
        id: t.id,
        name: t.name,
        billingMode: t.billingMode,
        projectId: t.project.id,
        projectName: t.project.name,
        clientId: t.project.client.id,
        clientName: t.project.client.name,
        colour: t.project.client.colour,
      })),
      recentTaskIds: recentIds,
      clients,
    };
  }

  // ── Clients ──────────────────────────────────────────────────────────────────────────────

  @Get("clients")
  async clients(@C() ctx: Ctx, @Query("archived") archived?: string) {
    const ws = ctx.workspace;
    const showArchived = archived === "1";
    const clients = await this.prisma.client.findMany({
      where: { workspaceId: ws.id, archivedAt: showArchived ? { not: null } : null },
      include: { projects: { where: { status: "active" }, select: { id: true } } },
      orderBy: { name: "asc" },
    });
    const today = todayIn(ctx.tz);
    const monthStart = `${today.slice(0, 7)}-01`;
    const hours = await this.prisma.$queryRaw<{ client_id: string; seconds: number }[]>`
      SELECT p.client_id, SUM(te.duration_seconds)::int AS seconds
      FROM time_entries te JOIN tasks t ON t.id = te.task_id JOIN projects p ON p.id = t.project_id
      WHERE te.workspace_id = ${ws.id}::uuid AND te.deleted_at IS NULL AND te.date >= ${monthStart}::date
      GROUP BY p.client_id`;
    const hoursMap = new Map(hours.map((h) => [h.client_id, h.seconds]));
    const rows = clients.map((c) => ({
      id: c.id,
      name: c.name,
      colour: c.colour,
      currency: c.currency,
      activeProjects: c.projects.length,
      secondsThisMonth: hoursMap.get(c.id) ?? 0,
      archived: !!c.archivedAt,
    }));
    if (!ctx.isAdmin) return { clients: rows };
    const unbilled = this.billing.rollupByClient(
      await this.billing.unbilledTasks(ws, { includeArchived: showArchived }),
    );
    const invoices = await this.billing.invoiceSummaries(ws, { status: "issued" });
    const money = rows.map((r) => {
      const inv = invoices.filter((i) => i.client.id === r.id && i.balanceMinor > 0);
      return {
        ...r,
        unbilledMinor: unbilled.get(r.id)?.amountMinor ?? 0,
        outstandingMinor: inv.reduce((s, i) => s + i.balanceMinor, 0),
        overdueMinor: inv
          .filter((i) => i.display.key === "overdue")
          .reduce((s, i) => s + i.balanceMinor, 0),
      };
    });
    return {
      clients: money,
      totals: {
        unbilled: sumByCurrency(
          money.map((m) => ({ minor: m.unbilledMinor, currency: m.currency })),
        ),
        outstanding: sumByCurrency(
          money.map((m) => ({ minor: m.outstandingMinor, currency: m.currency })),
        ),
        overdue: sumByCurrency(money.map((m) => ({ minor: m.overdueMinor, currency: m.currency }))),
      },
    };
  }

  @AdminOnly()
  @Post("clients")
  async createClient(@C() ctx: Ctx, @Body() body: unknown) {
    const input = parse(ClientInput, body);
    const used = await this.prisma.client.findMany({
      where: { workspaceId: ctx.workspace.id },
      select: { colour: true },
    });
    // A new client gets the next unused colour, not a random one (Guide §2.4).
    const counts = Array.from({ length: 10 }, (_, i) => used.filter((u) => u.colour === i).length);
    const colour = input.colour ?? counts.indexOf(Math.min(...counts));
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          workspaceId: ctx.workspace.id,
          name: input.name,
          contactName: input.contactName ?? "",
          billingEmails: input.billingEmails ?? [],
          address: input.address ?? "",
          taxId: input.taxId ?? "",
          currency: input.currency ?? ctx.workspace.currency,
          rateMinor: input.rateMinor ?? null,
          termsDays: input.termsDays ?? null,
          colour,
          notes: input.notes ?? "",
        },
      });
      await this.events.emit(tx, {
        ws: ctx.workspace.id,
        topic: "catalog",
        action: "client.created",
        entity: client.id,
      });
      return { id: client.id };
    });
  }

  @Get("clients/:id")
  async client(@C() ctx: Ctx, @Param("id") id: string) {
    const ws = ctx.workspace;
    const client = await this.prisma.client.findFirst({
      where: { id, workspaceId: ws.id },
      include: {
        projects: { orderBy: [{ status: "asc" }, { name: "asc" }] },
        defaultPaymentAccount: { select: { id: true, label: true } },
      },
    });
    if (!client) throw notFound("Client not found");
    const invoiceCount = await this.prisma.invoice.count({
      where: { clientId: id, status: { not: "draft" } },
    });
    const projectSeconds = await this.prisma.$queryRaw<{ project_id: string; seconds: number }[]>`
      SELECT t.project_id, SUM(te.duration_seconds)::int AS seconds
      FROM time_entries te JOIN tasks t ON t.id = te.task_id JOIN projects p ON p.id = t.project_id
      WHERE p.client_id = ${id}::uuid AND te.deleted_at IS NULL
      GROUP BY t.project_id`;
    const secMap = new Map(projectSeconds.map((r) => [r.project_id, r.seconds]));
    const base = {
      ...stripMoney(ctx, client),
      currencyLocked: invoiceCount > 0,
      canDelete: invoiceCount === 0,
      projects: client.projects.map((p) => ({
        ...stripMoney(ctx, p),
        trackedSeconds: secMap.get(p.id) ?? 0,
      })),
    };
    if (!ctx.isAdmin) return base;

    const tasks = await this.billing.unbilledTasks(ws, { clientId: id, includeArchived: true });
    const rollup = this.billing.rollupByClient(tasks).get(id);
    const invoices = await this.billing.invoiceSummaries(ws, { clientId: id });
    const issued = invoices.filter((i) => i.status === "issued");
    const year = todayIn(ws.timeZone).slice(0, 4);
    const perProject = new Map<string, number>();
    for (const t of tasks) {
      perProject.set(
        t.projectId,
        (perProject.get(t.projectId) ?? 0) + (t.hourlyMinor ?? 0) + t.fixedRemainingMinor,
      );
    }
    return {
      ...base,
      projects: base.projects.map((p) => ({ ...p, unbilledMinor: perProject.get(p.id) ?? 0 })),
      stats: {
        unbilledMinor: rollup?.amountMinor ?? 0,
        unbilledSeconds: rollup?.seconds ?? 0,
        noRateSeconds: rollup?.noRateSeconds ?? 0,
        outstandingMinor: issued
          .filter((i) => i.balanceMinor > 0)
          .reduce((s, i) => s + i.balanceMinor, 0),
        overdueMinor: issued
          .filter((i) => i.display.key === "overdue")
          .reduce((s, i) => s + i.balanceMinor, 0),
        invoicedThisYearMinor: issued
          .filter((i) => i.issueDate?.startsWith(year))
          .reduce((s, i) => s + i.totalMinor, 0),
      },
      invoices,
      lastInvoice: invoices.find((i) => i.status !== "draft") ?? null,
    };
  }

  @AdminOnly()
  @Patch("clients/:id")
  async updateClient(@C() ctx: Ctx, @Param("id") id: string, @Body() body: unknown) {
    const input = parse(ClientInput.partial(), body);
    const client = await this.prisma.client.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
    });
    if (!client) throw notFound("Client not found");
    if (input.currency && input.currency !== client.currency) {
      // One currency per client, locked at the first invoice (Brief §7.1).
      const n = await this.prisma.invoice.count({ where: { clientId: id } });
      if (n > 0)
        throw conflict(
          "currency_locked",
          "The currency is locked because this client has invoices.",
        );
    }
    if (input.defaultPaymentAccountId) {
      const acc = await this.prisma.paymentAccount.findFirst({
        where: {
          id: input.defaultPaymentAccountId,
          workspaceId: ctx.workspace.id,
          archivedAt: null,
        },
      });
      if (!acc || acc.currency !== (input.currency ?? client.currency)) {
        throw invalid("The default account must be in the client's currency.");
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.client.update({
        where: { id },
        data: {
          ...input,
          // A currency change clears the default account (07 §8.1).
          ...(input.currency && input.currency !== client.currency
            ? { defaultPaymentAccountId: null }
            : {}),
        },
      });
      await this.events.emit(tx, {
        ws: ctx.workspace.id,
        topic: "catalog",
        action: "client.updated",
        entity: id,
      });
    });
    return { ok: true };
  }

  @AdminOnly()
  @Post("clients/:id/archive")
  @HttpCode(200)
  async archive(@C() ctx: Ctx, @Param("id") id: string) {
    return this.setArchived(ctx, id, new Date());
  }

  @AdminOnly()
  @Post("clients/:id/restore")
  @HttpCode(200)
  async restore(@C() ctx: Ctx, @Param("id") id: string) {
    return this.setArchived(ctx, id, null);
  }

  private async setArchived(ctx: Ctx, id: string, at: Date | null) {
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.client.updateMany({
        where: { id, workspaceId: ctx.workspace.id },
        data: { archivedAt: at },
      });
      if (!r.count) throw notFound("Client not found");
      await this.events.emit(tx, {
        ws: ctx.workspace.id,
        topic: "catalog",
        action: "client.archived",
        entity: id,
      });
    });
    return { ok: true };
  }

  /** Only while the client has no sent or void invoices (08 §11). */
  @AdminOnly()
  @Delete("clients/:id")
  async deleteClient(@C() ctx: Ctx, @Param("id") id: string) {
    const n = await this.prisma.invoice.count({
      where: { clientId: id, status: { not: "draft" } },
    });
    if (n > 0)
      throw conflict(
        "has_invoices",
        "Clients with sent invoices are kept for your records. Archive it instead.",
      );
    await this.prisma.$transaction(async (tx) => {
      const drafts = await tx.invoice.findMany({ where: { clientId: id }, select: { id: true } });
      await tx.timeEntry.updateMany({
        where: { invoiceId: { in: drafts.map((d) => d.id) } },
        data: { invoiceId: null },
      });
      await tx.invoice.deleteMany({ where: { clientId: id } });
      const tasks = await tx.task.findMany({
        where: { project: { clientId: id } },
        select: { id: true },
      });
      const taskIds = tasks.map((t) => t.id);
      await tx.timeEntry.deleteMany({ where: { taskId: { in: taskIds } } });
      await tx.task.deleteMany({ where: { id: { in: taskIds } } });
      await tx.project.deleteMany({ where: { clientId: id } });
      await tx.client.deleteMany({ where: { id, workspaceId: ctx.workspace.id } });
      await this.events.emit(tx, {
        ws: ctx.workspace.id,
        topic: "catalog",
        action: "client.deleted",
        entity: id,
      });
    });
    return { ok: true };
  }

  // ── Projects ─────────────────────────────────────────────────────────────────────────────

  @AdminOnly()
  @Post("projects")
  async createProject(@C() ctx: Ctx, @Body() body: unknown) {
    const input = parse(ProjectInput, body);
    if (!input.clientId) throw invalid("Choose a client.");
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, workspaceId: ctx.workspace.id },
    });
    if (!client) throw notFound("Client not found");
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          workspaceId: ctx.workspace.id,
          clientId: client.id,
          name: input.name,
          rateMinor: input.rateMinor ?? null,
          budgetKind: input.budgetKind ?? null,
          budgetValue: input.budgetValue ?? null,
          notes: input.notes ?? "",
        },
      });
      await this.events.emit(tx, {
        ws: ctx.workspace.id,
        topic: "catalog",
        action: "project.created",
        entity: p.id,
      });
      return { id: p.id };
    });
  }

  @Get("projects/:id")
  async project(@C() ctx: Ctx, @Param("id") id: string) {
    const ws = ctx.workspace;
    const project = await this.prisma.project.findFirst({
      where: { id, workspaceId: ws.id },
      include: {
        client: true,
        tasks: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      },
    });
    if (!project) throw notFound("Project not found");
    const tracked = await this.prisma.$queryRaw<{ task_id: string; seconds: number }[]>`
      SELECT task_id, SUM(duration_seconds)::int AS seconds FROM time_entries
      WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ${id}::uuid) AND deleted_at IS NULL
      GROUP BY task_id`;
    const trackedMap = new Map(tracked.map((t) => [t.task_id, t.seconds]));
    const totalTracked = tracked.reduce((s, t) => s + t.seconds, 0);
    const tasksBase = project.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      billingMode: t.billingMode,
      estimateSeconds: t.estimateSeconds,
      done: !!t.doneAt,
      position: t.position,
      trackedSeconds: trackedMap.get(t.id) ?? 0,
      ...(ctx.isAdmin ? { rateMinor: t.rateMinor, fixedAmountMinor: t.fixedAmountMinor } : {}),
    }));
    const base = {
      id: project.id,
      name: project.name,
      status: project.status,
      notes: project.notes,
      budgetKind: project.budgetKind,
      client: {
        id: project.client.id,
        name: project.client.name,
        colour: project.client.colour,
        currency: project.client.currency,
      },
      trackedSeconds: totalTracked,
      ...(ctx.isAdmin ? { rateMinor: project.rateMinor, budgetValue: project.budgetValue } : {}),
      budgetValueHours: project.budgetKind === "hours" ? project.budgetValue : null,
    };
    if (!ctx.isAdmin) return { ...base, tasks: tasksBase };

    const unbilled = await this.billing.unbilledTasks(ws, { projectId: id, includeArchived: true });
    const ub = new Map(unbilled.map((u) => [u.taskId, u]));
    // Money budget used (07 §5): billed time/fixed lines on non-void invoices + unbilled value.
    let moneyUsed: number | null = null;
    if (project.budgetKind === "money") {
      const billed = await this.prisma.$queryRaw<{ amount: number }[]>`
        SELECT COALESCE(SUM(l.amount_minor), 0)::int AS amount
        FROM invoice_lines l
        JOIN invoice_versions v ON v.id = l.version_id
        JOIN invoices i ON i.id = v.invoice_id
        JOIN tasks t ON t.id = l.task_id
        WHERE t.project_id = ${id}::uuid AND i.status <> 'void' AND l.kind IN ('time', 'fixed')
          AND (v.id = i.current_version_id OR (i.status = 'draft' AND v.frozen_at IS NULL))`;
      const hourlyUnbilled = unbilled.reduce((s, u) => s + (u.hourlyMinor ?? 0), 0);
      const fixedUnbilled = unbilled.reduce((s, u) => s + u.fixedRemainingMinor, 0);
      moneyUsed = (billed[0]?.amount ?? 0) + hourlyUnbilled + fixedUnbilled;
    }
    const projectResolved = {
      rateMinor:
        project.rateMinor ??
        project.client.rateMinor ??
        (project.client.currency === ws.currency ? ws.defaultRateMinor : null),
      source:
        project.rateMinor != null
          ? "project"
          : project.client.rateMinor != null
            ? "client"
            : project.client.currency === ws.currency && ws.defaultRateMinor != null
              ? "workspace"
              : null,
    };
    return {
      ...base,
      inheritedRate: projectResolved,
      clientRateMinor: project.client.rateMinor,
      budgetUsed:
        project.budgetKind === "money"
          ? moneyUsed
          : project.budgetKind === "hours"
            ? totalTracked
            : null,
      unbilledMinor: unbilled.reduce((s, u) => s + (u.hourlyMinor ?? 0) + u.fixedRemainingMinor, 0),
      tasks: tasksBase.map((t) => {
        const u = ub.get(t.id);
        return {
          ...t,
          resolvedRateMinor: u?.rateMinor ?? null,
          rateSource: u?.rateSource ?? null,
          unbilledSeconds: u?.seconds ?? 0,
          unbilledMinor: (u?.hourlyMinor ?? 0) + (u?.fixedRemainingMinor ?? 0),
          fixedBilledMinor: u?.fixedBilledMinor ?? 0,
        };
      }),
    };
  }

  @AdminOnly()
  @Patch("projects/:id")
  async updateProject(@C() ctx: Ctx, @Param("id") id: string, @Body() body: unknown) {
    const input = parse(ProjectInput.partial(), body);
    const { clientId: _ignored, ...data } = input;
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.project.updateMany({ where: { id, workspaceId: ctx.workspace.id }, data });
      if (!r.count) throw notFound("Project not found");
      await this.events.emit(tx, {
        ws: ctx.workspace.id,
        topic: "catalog",
        action: "project.updated",
        entity: id,
      });
    });
    return { ok: true };
  }

  // ── Tasks ────────────────────────────────────────────────────────────────────────────────

  /** Members may create a task inline while tracking (Brief §6.1), with the default billing. */
  @Post("tasks")
  async createTask(@C() ctx: Ctx, @Body() body: unknown) {
    const input = parse(TaskInput, body);
    if (!input.projectId) throw invalid("Choose a project.");
    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, workspaceId: ctx.workspace.id },
    });
    if (!project) throw notFound("Project not found");
    const mode = ctx.isAdmin ? (input.billingMode ?? "hourly") : "hourly";
    if (mode === "fixed" && !input.fixedAmountMinor)
      throw invalid("A fixed-fee task needs an amount.", {
        fields: { fixedAmountMinor: "Enter the fee" },
      });
    return this.prisma.$transaction(async (tx) => {
      const max = await tx.task.aggregate({
        where: { projectId: project.id },
        _max: { position: true },
      });
      const t = await tx.task.create({
        data: {
          workspaceId: ctx.workspace.id,
          projectId: project.id,
          name: input.name,
          billingMode: mode,
          rateMinor: ctx.isAdmin && mode === "hourly" ? (input.rateMinor ?? null) : null,
          fixedAmountMinor: mode === "fixed" ? input.fixedAmountMinor : null,
          estimateSeconds: input.estimateSeconds ?? null,
          position: (max._max.position ?? 0) + 1,
        },
      });
      await this.events.emit(tx, {
        ws: ctx.workspace.id,
        topic: "catalog",
        action: "task.created",
        entity: t.id,
      });
      return { id: t.id };
    });
  }

  @Patch("tasks/:id")
  async updateTask(@C() ctx: Ctx, @Param("id") id: string, @Body() body: unknown) {
    const input = parse(TaskInput.partial(), body);
    const task = await this.prisma.task.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
    if (!task) throw notFound("Task not found");
    const touchesBilling = ["billingMode", "rateMinor", "fixedAmountMinor"].some((k) => k in input);
    if (touchesBilling && !ctx.isAdmin)
      throw conflict("forbidden", "Only admins change a task's billing.");
    const mode = input.billingMode ?? task.billingMode;
    if (task.billingMode === "fixed" && mode === "hourly") {
      // M9: blocked once part of the fee is billed.
      const billed = (await this.billing.fixedBilled(this.prisma, ctx.workspace.id)).get(id) ?? 0;
      if (billed > 0) {
        throw conflict(
          "fixed_billed",
          "Part of this fee is on an invoice. Add a new hourly task for the extra work.",
        );
      }
    }
    const fixedAmount = mode === "fixed" ? (input.fixedAmountMinor ?? task.fixedAmountMinor) : null;
    if (mode === "fixed" && !fixedAmount)
      throw invalid("A fixed-fee task needs an amount.", {
        fields: { fixedAmountMinor: "Enter the fee" },
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          billingMode: mode,
          rateMinor:
            mode === "hourly" ? ("rateMinor" in input ? input.rateMinor : task.rateMinor) : null,
          fixedAmountMinor: fixedAmount,
          ...("estimateSeconds" in input ? { estimateSeconds: input.estimateSeconds } : {}),
          ...("done" in input ? { doneAt: input.done ? new Date() : null } : {}),
        },
      });
      await this.events.emit(tx, {
        ws: ctx.workspace.id,
        topic: "catalog",
        action: "task.updated",
        entity: id,
      });
    });
    return { ok: true };
  }

  @AdminOnly()
  @Delete("tasks/:id")
  async deleteTask(@C() ctx: Ctx, @Param("id") id: string) {
    const n = await this.prisma.timeEntry.count({ where: { taskId: id } });
    if (n > 0) throw conflict("has_time", "This task has time entries. Mark it done instead.");
    await this.prisma.$transaction(async (tx) => {
      await tx.task.deleteMany({ where: { id, workspaceId: ctx.workspace.id } });
      await this.events.emit(tx, {
        ws: ctx.workspace.id,
        topic: "catalog",
        action: "task.deleted",
        entity: id,
      });
    });
    return { ok: true };
  }
}

export { d2s };
