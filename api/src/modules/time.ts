import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  affectsDocument,
  isCalendarDate,
  isValidTimeZone,
  type LineLayout,
  OffInvoiceInput,
  resolveRate,
  TimeEntryInput,
  TIMER_LIMIT,
  TimerStartInput,
  TimerUpdateInput,
  toLocalDate,
} from "@paypure/domain";
import { AdminOnly, C, type Ctx } from "../common/auth";
import { d2s, s2d, truncSec } from "../common/dates";
import { conflict, forbidden, invalid, notFound } from "../common/errors";
import { parse } from "../common/zod";
import type { TimeEntry, TimeEntrySegment } from "../generated/prisma/client";
import { Prisma, PrismaService, type Tx } from "../prisma.service";
import { EventsService } from "./events";

type EntryWithSegments = TimeEntry & { segments: TimeEntrySegment[] };

const taskInclude = {
  select: {
    id: true,
    name: true,
    billingMode: true,
    rateMinor: true,
    project: {
      select: {
        id: true,
        name: true,
        rateMinor: true,
        client: { select: { id: true, name: true, colour: true, currency: true, rateMinor: true } },
      },
    },
  },
} as const;

/**
 * Time entries, segments and the timer (06 §2). Every transition is a guarded update on server
 * time, so a late or repeated action is a no-op (`applied: false`), never an error.
 */
@Controller("v1")
export class TimeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  // ── Timer ────────────────────────────────────────────────────────────────────────────────

  private async snapshot(db: Tx | PrismaService, entryId: string | null, applied = true) {
    if (!entryId) return { entry: null, applied };
    const e = await db.timeEntry.findUnique({
      where: { id: entryId },
      include: { segments: { orderBy: { startedAt: "asc" } }, task: taskInclude },
    });
    if (!e || e.deletedAt) return { entry: null, applied };
    const closed = e.segments.filter((s) => s.endedAt);
    const open = e.segments.find((s) => !s.endedAt);
    return {
      applied,
      entry: {
        id: e.id,
        state: e.state,
        date: d2s(e.date),
        timeZone: e.timeZone,
        note: e.note,
        billable: e.billable,
        version: e.version,
        task: e.task
          ? {
              id: e.task.id,
              name: e.task.name,
              billingMode: e.task.billingMode,
              projectName: e.task.project.name,
              clientName: e.task.project.client.name,
              colour: e.task.project.client.colour,
            }
          : null,
        segments: e.segments.map((s) => ({ startedAt: s.startedAt.toISOString(), endedAt: s.endedAt?.toISOString() ?? null })),
        workedSecondsClosed: closed.reduce((s, x) => s + secondsBetween(x.startedAt, x.endedAt as Date), 0),
        openSince: open?.startedAt.toISOString() ?? null,
        firstStartedAt: e.segments[0]?.startedAt.toISOString() ?? null,
      },
    };
  }

  private async emitTimer(tx: Tx, ctx: Ctx, action: string, entryId: string | null) {
    const snap = await this.snapshot(tx, entryId);
    await this.events.emit(tx, {
      ws: ctx.workspace.id,
      member: ctx.member.id,
      topic: "timer",
      action,
      entity: entryId ?? undefined,
      timer: snap.entry,
    });
    await this.events.emit(tx, { ws: ctx.workspace.id, member: ctx.member.id, topic: "time", action, entity: entryId ?? undefined });
  }

  /** Every live timer of the member, newest first (parallel timers, 06 §2.4). */
  @Get("timer")
  async getTimer(@C() ctx: Ctx) {
    const live = await this.prisma.timeEntry.findMany({
      where: { memberId: ctx.member.id, state: { not: "stopped" }, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    const snaps = await Promise.all(live.map((e) => this.snapshot(this.prisma, e.id)));
    return { entries: snaps.map((x) => x.entry).filter(Boolean) };
  }

  /** Close the open segment and recompute the cache columns (invariant 2, 06 §2.3). */
  private async finalize(tx: Tx, entryId: string, state: "paused" | "stopped", now: Date) {
    // Closing an open segment in the second it started would violate segment_positive: drop it first.
    await tx.$executeRaw`DELETE FROM time_entry_segments WHERE time_entry_id = ${entryId}::uuid AND ended_at IS NULL AND started_at >= ${now}`;
    await tx.timeEntrySegment.updateMany({ where: { timeEntryId: entryId, endedAt: null }, data: { endedAt: now } });
    const segs = await tx.timeEntrySegment.findMany({ where: { timeEntryId: entryId }, orderBy: { startedAt: "asc" } });
    const duration = segs.reduce((s, x) => s + secondsBetween(x.startedAt, x.endedAt as Date), 0);
    await tx.timeEntry.update({
      where: { id: entryId },
      data: {
        state,
        durationSeconds: duration,
        startedAt: segs[0]?.startedAt ?? null,
        endedAt: state === "stopped" ? (segs[segs.length - 1]?.endedAt ?? null) : null,
        version: { increment: 1 },
      },
    });
    return duration;
  }

  /** Serialise the member's timer starts and restores (06 §2.8). Released at commit. */
  private async lockMember(tx: Tx, ctx: Ctx) {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(6060, hashtext(${ctx.member.id}))) AS l`;
  }

  /** Refuse when one more live entry would pass the limit (06 §2.4). Call under lockMember. */
  private async assertRoom(tx: Tx, ctx: Ctx, adding = 1) {
    const live = await tx.timeEntry.count({ where: { memberId: ctx.member.id, state: { not: "stopped" }, deletedAt: null } });
    if (live + adding > TIMER_LIMIT) {
      throw conflict("timer_limit", `You have ${TIMER_LIMIT} timers live. Stop one first.`);
    }
  }

  /** A second live timer on one task (06 §2.2 one_live_timer_per_task). */
  private static taskLive(e: unknown) {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
      ? conflict("task_live", "A timer is already live on that task.")
      : e;
  }

  @Post("timer/start")
  @HttpCode(200)
  async start(@C() ctx: Ctx, @Body() body: unknown) {
    const input = parse(TimerStartInput, body);
    const tz = input.tz && isValidTimeZone(input.tz) ? input.tz : ctx.tz;
    // Parallel timers: starting never stops another one (06 §2.4).
    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = truncSec(new Date());
        let task = null;
        if (input.taskId) {
          task = await tx.task.findFirst({ where: { id: input.taskId, workspaceId: ctx.workspace.id } });
          if (!task) throw notFound("Task not found");
        }
        await this.lockMember(tx, ctx);
        if (task) {
          // One live timer per task: hand back the one already running (06 §2.4).
          const same = await tx.timeEntry.findFirst({
            where: { memberId: ctx.member.id, taskId: task.id, state: { not: "stopped" }, deletedAt: null },
            select: { id: true },
          });
          if (same) return { ...(await this.snapshot(tx, same.id, false)), existing: true };
        }
        await this.assertRoom(tx, ctx);
        let startAt = now;
        if (input.offsetSeconds) startAt = new Date(now.getTime() - input.offsetSeconds * 1000);
        if (input.afterLastEntry) {
          const last = await tx.timeEntry.findFirst({
            where: { memberId: ctx.member.id, deletedAt: null, endedAt: { not: null } },
            orderBy: { endedAt: "desc" },
          });
          if (last?.endedAt && last.endedAt < now) startAt = last.endedAt;
        }
        const entry = await tx.timeEntry.create({
          data: {
            workspaceId: ctx.workspace.id,
            memberId: ctx.member.id,
            taskId: task?.id ?? null,
            state: "running",
            timeZone: tz,
            date: s2d(toLocalDate(startAt, tz)),
            startedAt: startAt,
            note: input.note ?? "",
            billable: task ? task.billingMode === "hourly" : true,
            segments: { create: { workspaceId: ctx.workspace.id, startedAt: startAt } },
          },
        });
        await this.emitTimer(tx, ctx, "started", entry.id);
        return { ...(await this.snapshot(tx, entry.id)), existing: false };
      });
    } catch (e) {
      throw TimeController.taskLive(e);
    }
  }

  @Post("timer/:id/pause")
  @HttpCode(200)
  async pause(@C() ctx: Ctx, @Param("id") id: string) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.timeEntry.updateMany({
        where: { id, memberId: ctx.member.id, state: "running", deletedAt: null },
        data: { state: "paused" },
      });
      if (!r.count) return this.snapshot(tx, id, false);
      await this.finalize(tx, id, "paused", truncSec(new Date()));
      await this.emitTimer(tx, ctx, "paused", id);
      return this.snapshot(tx, id);
    });
  }

  @Post("timer/:id/resume")
  @HttpCode(200)
  async resume(@C() ctx: Ctx, @Param("id") id: string) {
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.timeEntry.findFirst({
        where: { id, memberId: ctx.member.id, state: "paused", deletedAt: null },
        include: { segments: { orderBy: { startedAt: "desc" }, take: 1 } },
      });
      if (!e) return this.snapshot(tx, id, false);
      const now = truncSec(new Date());
      const lastEnd = e.segments[0]?.endedAt ?? e.startedAt ?? now;
      // Paused across midnight: stop yesterday's entry and start a new one (06 §2.6).
      if (toLocalDate(now, e.timeZone) !== toLocalDate(lastEnd, e.timeZone)) {
        if (!e.taskId) throw conflict("needs_task", "Choose a task for yesterday's timer first.", { entryId: e.id });
        await this.finalize(tx, e.id, "stopped", now);
        const fresh = await tx.timeEntry.create({
          data: {
            workspaceId: ctx.workspace.id,
            memberId: ctx.member.id,
            taskId: e.taskId,
            state: "running",
            timeZone: e.timeZone,
            date: s2d(toLocalDate(now, e.timeZone)),
            startedAt: now,
            billable: e.billable,
            segments: { create: { workspaceId: ctx.workspace.id, startedAt: now } },
          },
        });
        await this.emitTimer(tx, ctx, "started", fresh.id);
        return { ...(await this.snapshot(tx, fresh.id)), newDay: true, previousEntryId: e.id };
      }
      await tx.timeEntry.update({ where: { id }, data: { state: "running", endedAt: null, version: { increment: 1 } } });
      await tx.timeEntrySegment.create({ data: { workspaceId: ctx.workspace.id, timeEntryId: id, startedAt: now } });
      await this.emitTimer(tx, ctx, "resumed", id);
      return this.snapshot(tx, id);
    });
  }

  @Post("timer/:id/stop")
  @HttpCode(200)
  async stop(@C() ctx: Ctx, @Param("id") id: string) {
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.timeEntry.findFirst({
        where: { id, memberId: ctx.member.id, state: { not: "stopped" }, deletedAt: null },
      });
      if (!e) return this.snapshot(tx, id, false);
      const now = truncSec(new Date());
      if (!e.taskId) {
        // Stop with no task pauses, so no time accrues while choosing (06 §2.7).
        if (e.state === "running") await this.finalize(tx, id, "paused", now);
        await this.emitTimer(tx, ctx, "paused", id);
        return { ...(await this.snapshot(tx, id)), needsTask: true };
      }
      const seconds = await this.finalize(tx, id, "stopped", now);
      await this.emitTimer(tx, ctx, "stopped", id);
      return { entry: null, applied: true, stopped: { id, seconds, prevState: e.state } };
    });
  }

  @Post("timer/:id/discard")
  @HttpCode(200)
  async discard(@C() ctx: Ctx, @Param("id") id: string) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.timeEntry.updateMany({
        where: { id, memberId: ctx.member.id, state: { not: "stopped" }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (r.count) await this.emitTimer(tx, ctx, "discarded", id);
      return { entry: null, applied: r.count > 0 };
    });
  }

  /** Undo for "stop" / "discard": restore an entry to its previous live state. */
  @Post("timer/:id/restore")
  @HttpCode(200)
  async restoreTimer(@C() ctx: Ctx, @Param("id") id: string, @Body() body: { state?: "running" | "paused" }) {
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.timeEntry.findFirst({ where: { id, memberId: ctx.member.id } });
      if (!e || e.invoiceId || e.offInvoice) return { entry: null, applied: false };
      // Undoing a stop or a discard makes the entry live again, so it counts toward the limit.
      if (e.deletedAt ? e.state !== "stopped" : e.state === "stopped") {
        await this.lockMember(tx, ctx);
        await this.assertRoom(tx, ctx);
      }
      try {
        if (e.deletedAt) {
          await tx.timeEntry.update({ where: { id }, data: { deletedAt: null, version: { increment: 1 } } });
        } else if (e.state === "stopped") {
          const now = truncSec(new Date());
          const target = body.state ?? "running";
          await tx.timeEntry.update({ where: { id }, data: { state: target, endedAt: null, version: { increment: 1 } } });
          if (target === "running") {
            await tx.timeEntrySegment.create({ data: { workspaceId: ctx.workspace.id, timeEntryId: id, startedAt: now } });
          }
        }
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw conflict("task_live", "You've started another timer on this task since. Stop it first.");
        }
        throw err;
      }
      await this.emitTimer(tx, ctx, "restored", id);
      return this.snapshot(tx, id);
    });
  }

  @Patch("timer/:id")
  async updateTimer(@C() ctx: Ctx, @Param("id") id: string, @Body() body: unknown) {
    const input = parse(TimerUpdateInput, body);
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.timeEntry.findFirst({
        where: { id, memberId: ctx.member.id, state: { not: "stopped" }, deletedAt: null },
        include: { segments: { orderBy: { startedAt: "asc" } } },
      });
      if (!e) return this.snapshot(tx, id, false);
      const data: Prisma.TimeEntryUpdateInput = { version: { increment: 1 } };
      if ("taskId" in input && input.taskId) {
        const task = await tx.task.findFirst({ where: { id: input.taskId, workspaceId: ctx.workspace.id } });
        if (!task) throw notFound("Task not found");
        const other = await tx.timeEntry.findFirst({
          where: { memberId: ctx.member.id, taskId: task.id, state: { not: "stopped" }, deletedAt: null, id: { not: id } },
          select: { id: true },
        });
        if (other) throw conflict("task_live", "Another of your timers is already on that task.", { entryId: other.id });
        data.task = { connect: { id: task.id } };
        // billable is re-derived from the mode when a task is first set (06 §2.7)
        if (!e.taskId || input.billable === undefined) data.billable = task.billingMode === "hourly";
      }
      if (input.note !== undefined) data.note = input.note;
      if (input.billable !== undefined) data.billable = input.billable;
      if (input.startedAt) {
        const first = e.segments[0];
        const at = truncSec(new Date(input.startedAt));
        const limit = first?.endedAt ?? new Date();
        if (at >= limit) throw invalid("The start must be before the timer's first break or now.");
        if (first) await tx.timeEntrySegment.update({ where: { id: first.id }, data: { startedAt: at } });
        data.startedAt = at;
        data.date = s2d(toLocalDate(at, e.timeZone));
        await this.recomputeDuration(tx, id);
      }
      await tx.timeEntry.update({ where: { id }, data });
      await this.emitTimer(tx, ctx, "updated", id);
      return this.snapshot(tx, id);
    });
  }

  private async recomputeDuration(tx: Tx, id: string) {
    const segs = await tx.timeEntrySegment.findMany({ where: { timeEntryId: id, endedAt: { not: null } } });
    await tx.timeEntry.update({
      where: { id },
      data: { durationSeconds: segs.reduce((s, x) => s + secondsBetween(x.startedAt, x.endedAt as Date), 0) },
    });
  }

  // ── Entries ──────────────────────────────────────────────────────────────────────────────

  @Get("time-entries")
  async list(
    @C() ctx: Ctx,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("member") member?: string,
    @Query("client") client?: string,
    @Query("project") project?: string,
    @Query("state") state?: string,
    @Query("invoice") invoice?: string,
  ) {
    const memberId = member === "all" && ctx.isAdmin ? undefined : member && ctx.isAdmin ? member : ctx.member.id;
    const where: Prisma.TimeEntryWhereInput = {
      workspaceId: ctx.workspace.id,
      deletedAt: null,
      ...(memberId ? { memberId } : {}),
      ...(from && isCalendarDate(from) ? { date: { gte: s2d(from), ...(to && isCalendarDate(to) ? { lte: s2d(to) } : {}) } } : {}),
      ...(client ? { task: { project: { clientId: client } } } : {}),
      ...(project ? { task: { projectId: project } } : {}),
      ...(invoice && ctx.isAdmin ? { invoiceId: invoice } : {}),
    };
    if (state === "unbilled") Object.assign(where, { invoiceId: null, offInvoice: null, billable: true, state: "stopped", task: { ...(where.task as object), billingMode: "hourly" } });
    if (state === "billed") where.invoiceId = { not: null };
    if (state === "billed_elsewhere") where.offInvoice = "billed_elsewhere";
    if (state === "written_off") where.offInvoice = "written_off";
    const entries = await this.prisma.timeEntry.findMany({
      where,
      include: {
        segments: { orderBy: { startedAt: "asc" } },
        task: taskInclude,
        member: { select: { id: true, name: true } },
        invoice: { select: { id: true, number: true, status: true, versions: { where: { frozenAt: null }, select: { id: true } } } },
        changes: { where: { version: { frozenAt: null } }, select: { id: true } },
      },
      orderBy: [{ date: "desc" }, { startedAt: "asc" }, { createdAt: "asc" }],
      take: 2000,
    });
    const ws = ctx.workspace;
    return entries.map((e) => {
      let valueMinor: number | null = null;
      let rate: { rateMinor: number; source: string } | null = null;
      if (ctx.isAdmin && e.task && e.task.billingMode === "hourly" && e.billable) {
        const c = e.task.project.client;
        rate = resolveRate({
          taskRateMinor: e.task.rateMinor,
          projectRateMinor: e.task.project.rateMinor,
          clientRateMinor: c.rateMinor,
          clientCurrency: c.currency,
          workspaceRateMinor: ws.defaultRateMinor,
          workspaceCurrency: ws.currency,
        });
        valueMinor = rate ? Math.round((e.durationSeconds * rate.rateMinor) / 3600) : null;
      }
      return {
        id: e.id,
        state: e.state,
        date: d2s(e.date),
        timeZone: e.timeZone,
        startedAt: e.startedAt?.toISOString() ?? null,
        endedAt: e.endedAt?.toISOString() ?? null,
        durationSeconds: e.durationSeconds,
        segments: e.segments.map((s) => ({ startedAt: s.startedAt.toISOString(), endedAt: s.endedAt?.toISOString() ?? null })),
        note: e.note,
        billable: e.billable,
        version: e.version,
        member: e.member,
        task: e.task
          ? {
              id: e.task.id,
              name: e.task.name,
              billingMode: e.task.billingMode,
              projectId: e.task.project.id,
              projectName: e.task.project.name,
              clientId: e.task.project.client.id,
              clientName: e.task.project.client.name,
              colour: e.task.project.client.colour,
              currency: e.task.project.client.currency,
            }
          : null,
        invoice: e.invoice ? { id: e.invoice.id, number: e.invoice.number, status: e.invoice.status } : null,
        offInvoice: e.offInvoice,
        offInvoiceRef: e.offInvoiceRef,
        changePending: e.changes.length > 0,
        ...(ctx.isAdmin ? { valueMinor, rate } : {}),
      };
    });
  }

  private async loadEntry(tx: Tx, ctx: Ctx, id: string) {
    const e = await tx.timeEntry.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      include: { segments: { orderBy: { startedAt: "asc" } }, invoice: true },
    });
    if (!e) throw notFound("Time entry not found");
    if (e.memberId !== ctx.member.id && !ctx.isAdmin) throw forbidden("You can only change your own time.");
    return e;
  }

  /** Validate and normalise segments (06 §2.9): ordered, positive, no overlap. */
  private normaliseSegments(segs: { startedAt: string; endedAt: string }[]) {
    const out = segs
      .map((s) => ({ startedAt: truncSec(new Date(s.startedAt)), endedAt: truncSec(new Date(s.endedAt)) }))
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    for (let i = 0; i < out.length; i++) {
      if (out[i].endedAt <= out[i].startedAt) throw invalid("Each end must be after its start.", { fields: { end: "End is before start" } });
      if (i > 0 && out[i].startedAt < out[i - 1].endedAt) throw invalid("Breaks can't overlap.");
    }
    return out;
  }

  @Post("time-entries")
  async create(@C() ctx: Ctx, @Body() body: unknown) {
    const input = parse(TimeEntryInput, body);
    const memberId = input.memberId && ctx.isAdmin ? input.memberId : ctx.member.id;
    const tz = input.tz && isValidTimeZone(input.tz) ? input.tz : ctx.tz;
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({ where: { id: input.taskId, workspaceId: ctx.workspace.id } });
      if (!task) throw notFound("Task not found");
      const segs = input.segments ? this.normaliseSegments(input.segments) : null;
      if (!segs && !input.durationSeconds) throw invalid("Enter a duration or a start and end.");
      const duration = segs ? segs.reduce((s, x) => s + secondsBetween(x.startedAt, x.endedAt), 0) : (input.durationSeconds as number);
      const e = await tx.timeEntry.create({
        data: {
          workspaceId: ctx.workspace.id,
          memberId,
          taskId: task.id,
          state: "stopped",
          timeZone: tz,
          // An entry belongs to the local date of its first segment (Brief §7.1)
          date: s2d(segs ? toLocalDate(segs[0].startedAt, tz) : input.date),
          startedAt: segs?.[0].startedAt ?? null,
          endedAt: segs?.[segs.length - 1].endedAt ?? null,
          durationSeconds: duration,
          note: input.note,
          billable: task.billingMode === "hourly" ? (input.billable ?? true) : false,
          ...(segs ? { segments: { create: segs.map((s) => ({ ...s, workspaceId: ctx.workspace.id })) } } : {}),
        },
      });
      await this.events.emit(tx, { ws: ctx.workspace.id, member: memberId, topic: "time", action: "created", entity: e.id });
      return { id: e.id };
    });
  }

  @Patch("time-entries/:id")
  async update(@C() ctx: Ctx, @Param("id") id: string, @Body() body: unknown) {
    const input = parse(TimeEntryInput, body);
    return this.prisma.$transaction(async (tx) => {
      const e = await this.loadEntry(tx, ctx, id);
      if (e.state !== "stopped") throw conflict("live", "Edit a running timer from the timer.");
      if (input.version !== undefined && input.version !== e.version) {
        throw conflict("version_conflict", "Changed on another device. Reload to see the latest.");
      }
      const task = await tx.task.findFirst({ where: { id: input.taskId, workspaceId: ctx.workspace.id } });
      if (!task) throw notFound("Task not found");
      const segs = input.segments ? this.normaliseSegments(input.segments) : null;
      const duration = segs
        ? segs.reduce((s, x) => s + secondsBetween(x.startedAt, x.endedAt), 0)
        : (input.durationSeconds ?? e.durationSeconds);
      const next = {
        taskId: task.id,
        date: segs ? toLocalDate(segs[0].startedAt, e.timeZone) : input.date,
        startedAt: segs?.[0].startedAt.toISOString() ?? null,
        endedAt: segs?.[segs.length - 1].endedAt.toISOString() ?? null,
        durationSeconds: duration,
        note: input.note,
        billable: task.billingMode === "hourly" ? (input.billable ?? e.billable) : e.billable,
      };

      // Billed on an issued invoice → stage the change on the correction (08 §5.2).
      if (e.invoice?.status === "issued") {
        if (!ctx.isAdmin) throw forbidden("This time is on a sent invoice. Ask an admin to propose a change.");
        const current = await tx.invoiceVersion.findUnique({ where: { id: e.invoice.currentVersionId as string } });
        const changed = diffEntry(e, next);
        if (changed.length === 0) return { ok: true, staged: false };
        if (!affectsDocument(changed.map(snake), (current?.lineLayout as unknown as LineLayout) ?? { mode: "per_task", showDates: true, showNotes: false })) {
          // Not printed (e.g. a note under a layout that doesn't show notes): save normally.
          await tx.$executeRaw`SELECT set_config('paypure.applying_version', 'note-only', true)`;
          await tx.timeEntry.update({ where: { id }, data: { note: next.note, version: { increment: 1 } } });
          await this.events.emit(tx, { ws: ctx.workspace.id, member: e.memberId, topic: "time", action: "updated", entity: id });
          return { ok: true, staged: false };
        }
        const version = await this.openCorrection(tx, ctx, e.invoice.id);
        await tx.invoiceEntryChange.upsert({
          where: { versionId_timeEntryId: { versionId: version.id, timeEntryId: id } },
          create: {
            versionId: version.id,
            timeEntryId: id,
            op: task.id !== e.taskId ? "move" : "update",
            changes: Object.fromEntries(changed.map((k) => [k, [ (e as Record<string, unknown>)[k] instanceof Date ? ((e as Record<string, unknown>)[k] as Date).toISOString() : (e as Record<string, unknown>)[k], (next as Record<string, unknown>)[k]]])) as Prisma.InputJsonValue,
            segments: segs ? (segs.map((s) => ({ startedAt: s.startedAt.toISOString(), endedAt: s.endedAt.toISOString() })) as Prisma.InputJsonValue) : Prisma.DbNull,
          },
          update: {
            op: task.id !== e.taskId ? "move" : "update",
            changes: Object.fromEntries(changed.map((k) => [k, [null, (next as Record<string, unknown>)[k]]])) as Prisma.InputJsonValue,
            segments: segs ? (segs.map((s) => ({ startedAt: s.startedAt.toISOString(), endedAt: s.endedAt.toISOString() })) as Prisma.InputJsonValue) : Prisma.DbNull,
          },
        });
        await this.events.emit(tx, { ws: ctx.workspace.id, topic: "invoice", action: "change_staged", entity: e.invoice.id });
        await this.events.emit(tx, { ws: ctx.workspace.id, member: e.memberId, topic: "time", action: "staged", entity: id });
        return { ok: true, staged: true, invoiceId: e.invoice.id, invoiceNumber: e.invoice.number };
      }

      if (segs) {
        await tx.timeEntrySegment.deleteMany({ where: { timeEntryId: id } });
        await tx.timeEntrySegment.createMany({ data: segs.map((s) => ({ ...s, workspaceId: ctx.workspace.id, timeEntryId: id })) });
      } else if (input.durationSeconds) {
        // Switching to Duration drops the segments (06 §2.9)
        await tx.timeEntrySegment.deleteMany({ where: { timeEntryId: id } });
      }
      await tx.timeEntry.update({
        where: { id },
        data: {
          taskId: next.taskId,
          date: s2d(next.date),
          startedAt: segs ? next.startedAt : null,
          endedAt: segs ? next.endedAt : null,
          durationSeconds: next.durationSeconds,
          note: next.note,
          billable: next.billable,
          version: { increment: 1 },
        },
      });
      await this.events.emit(tx, { ws: ctx.workspace.id, member: e.memberId, topic: "time", action: "updated", entity: id });
      if (e.invoiceId) await this.events.emit(tx, { ws: ctx.workspace.id, topic: "invoice", action: "lines_outdated", entity: e.invoiceId });
      return { ok: true, staged: false, onDraft: !!e.invoiceId };
    });
  }

  /** The invoice's open correction, created from the current version if needed (08 §4.2). */
  private async openCorrection(tx: Tx, ctx: Ctx, invoiceId: string) {
    const open = await tx.invoiceVersion.findFirst({ where: { invoiceId, frozenAt: null } });
    if (open) return open;
    const { openCorrectionTx } = await import("./invoice-ops");
    return openCorrectionTx(tx, ctx, invoiceId);
  }

  @Delete("time-entries/:id")
  async remove(@C() ctx: Ctx, @Param("id") id: string) {
    return this.prisma.$transaction(async (tx) => {
      const e = await this.loadEntry(tx, ctx, id);
      if (e.invoice?.status === "issued") {
        throw conflict("billed", `This time is on invoice ${e.invoice.number}. Propose a change there.`);
      }
      if (e.invoiceId) {
        // On a draft: release the claim; the draft's lines go out of date.
        await tx.invoiceLineEntry.deleteMany({ where: { timeEntryId: id, line: { version: { frozenAt: null } } } });
      }
      await tx.timeEntry.update({ where: { id }, data: { deletedAt: new Date(), invoiceId: null, version: { increment: 1 } } });
      await this.events.emit(tx, { ws: ctx.workspace.id, member: e.memberId, topic: "time", action: "deleted", entity: id });
      return { ok: true };
    });
  }

  @Post("time-entries/:id/restore")
  @HttpCode(200)
  async restore(@C() ctx: Ctx, @Param("id") id: string) {
    return this.prisma.$transaction(async (tx) => {
      const e = await this.loadEntry(tx, ctx, id);
      await tx.timeEntry.update({ where: { id }, data: { deletedAt: null, version: { increment: 1 } } });
      await this.events.emit(tx, { ws: ctx.workspace.id, member: e.memberId, topic: "time", action: "restored", entity: id });
      return { ok: true };
    });
  }

  @Post("time-entries/:id/duplicate")
  @HttpCode(200)
  async duplicate(@C() ctx: Ctx, @Param("id") id: string) {
    return this.prisma.$transaction(async (tx) => {
      const e = await this.loadEntry(tx, ctx, id);
      const copy = await tx.timeEntry.create({
        data: {
          workspaceId: e.workspaceId,
          memberId: e.memberId,
          taskId: e.taskId,
          state: "stopped",
          timeZone: e.timeZone,
          date: e.date,
          durationSeconds: e.durationSeconds,
          note: e.note,
          billable: e.billable,
        },
      });
      await this.events.emit(tx, { ws: ctx.workspace.id, member: e.memberId, topic: "time", action: "created", entity: copy.id });
      return { id: copy.id };
    });
  }

  /** Take off unbilled: billed elsewhere / written off, or restore with kind = null (D10). */
  @AdminOnly()
  @Post("time-entries/off-invoice")
  @HttpCode(200)
  async offInvoice(@C() ctx: Ctx, @Body() body: unknown) {
    const input = parse(OffInvoiceInput, body);
    return this.prisma.$transaction(async (tx) => {
      const r = input.kind
        ? await tx.timeEntry.updateMany({
            where: { id: { in: input.entryIds }, workspaceId: ctx.workspace.id, invoiceId: null, state: "stopped", deletedAt: null },
            data: {
              offInvoice: input.kind,
              offInvoiceRef: input.kind === "billed_elsewhere" ? (input.ref ?? "") : null,
              offInvoiceNote: input.note ?? null,
              version: { increment: 1 },
            },
          })
        : await tx.timeEntry.updateMany({
            where: { id: { in: input.entryIds }, workspaceId: ctx.workspace.id, offInvoice: { not: null } },
            data: { offInvoice: null, offInvoiceRef: null, offInvoiceNote: null, version: { increment: 1 } },
          });
      await this.events.emit(tx, { ws: ctx.workspace.id, member: ctx.member.id, topic: "time", action: "off_invoice" });
      return { count: r.count };
    });
  }

  @Post("time-entries/bulk")
  @HttpCode(200)
  async bulk(@C() ctx: Ctx, @Body() body: { entryIds: string[]; action: "delete" | "billable" | "non_billable" | "move"; taskId?: string }) {
    const ids = Array.isArray(body.entryIds) ? body.entryIds.slice(0, 1000) : [];
    return this.prisma.$transaction(async (tx) => {
      const where: Prisma.TimeEntryWhereInput = {
        id: { in: ids },
        workspaceId: ctx.workspace.id,
        state: "stopped",
        deletedAt: null,
        OR: [{ invoiceId: null }, { invoice: { status: "draft" } }],
        ...(ctx.isAdmin ? {} : { memberId: ctx.member.id }),
      };
      let count = 0;
      if (body.action === "delete") {
        count = (await tx.timeEntry.updateMany({ where, data: { deletedAt: new Date(), invoiceId: null } })).count;
      } else if (body.action === "billable" || body.action === "non_billable") {
        count = (await tx.timeEntry.updateMany({ where, data: { billable: body.action === "billable", version: { increment: 1 } } })).count;
      } else if (body.action === "move" && body.taskId) {
        const task = await tx.task.findFirst({ where: { id: body.taskId, workspaceId: ctx.workspace.id } });
        if (!task) throw notFound("Task not found");
        count = (await tx.timeEntry.updateMany({ where, data: { taskId: task.id, version: { increment: 1 } } })).count;
      }
      await this.events.emit(tx, { ws: ctx.workspace.id, member: ctx.member.id, topic: "time", action: "bulk" });
      return { count, skipped: ids.length - count };
    });
  }
}

export function secondsBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 1000);
}

const snake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

function diffEntry(e: EntryWithSegments | TimeEntry, next: Record<string, unknown>): string[] {
  const cur: Record<string, unknown> = {
    taskId: e.taskId,
    date: d2s(e.date),
    startedAt: e.startedAt?.toISOString() ?? null,
    endedAt: e.endedAt?.toISOString() ?? null,
    durationSeconds: e.durationSeconds,
    note: e.note,
    billable: e.billable,
  };
  return Object.keys(cur).filter((k) => cur[k] !== next[k]);
}
