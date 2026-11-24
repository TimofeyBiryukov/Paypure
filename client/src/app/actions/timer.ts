"use server";

import { formatDuration } from "@paypure/domain";
import { revalidatePath } from "next/cache";
import { type ActionState, run, str } from "@/lib/action";
import type { TimerResult, TimerSnapshot } from "@/lib/types";
import { ApiError, api } from "@/server/api";

type Snap = { entry: TimerSnapshot | null; applied: boolean; existing?: boolean; needsTask?: boolean; newDay?: boolean; previousEntryId?: string; stopped?: { id: string; seconds: number; prevState: string } };

const label = (e: TimerSnapshot | null) => (e?.task ? `${e.task.clientName} · ${e.task.name}` : "");
/** One entry changed. */
const one = (id: string, timer: TimerSnapshot | null, extra: Omit<TimerResult, "updates"> = {}): TimerResult => ({ updates: [{ id, timer }], ...extra });

/**
 * Timer actions (06 §2.4). Each is a real <form> with a hidden entry id (Guide §7.1). Timers run
 * in parallel, so every result lists the entries it changed (`TimerResult`) and the client
 * updates just those.
 */
export async function startTimer(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const taskId = str(fd, "taskId") || null;
    const when = str(fd, "when");
    const body: Record<string, unknown> = { taskId };
    if (when === "last") body.afterLastEntry = true;
    else if (when) body.offsetSeconds = Number(when) * 60;
    const note = str(fd, "note");
    if (note) body.note = note;
    let r: Snap;
    try {
      r = await api<Snap>("/v1/timer/start", { body });
    } catch (e) {
      // Shown as a toast: the ⏵ buttons on task rows have no room for an inline error.
      if (e instanceof ApiError && e.code === "timer_limit") return { toast: { text: e.message, tone: "danger" } };
      throw e;
    }
    revalidatePath("/", "layout");
    return {
      data: r.entry ? { ...one(r.entry.id, r.entry, { focus: r.entry.id, existing: !!r.existing }) } : undefined,
      toast: r.existing ? { text: `Already running: ${label(r.entry)}` } : undefined,
    };
  });
}

export async function timerTransition(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async (): Promise<ActionState> => {
    const id = str(fd, "entryId");
    const op = str(fd, "op");
    if (!["pause", "resume", "stop", "discard"].includes(op)) throw new Error("bad op");
    const r = await api<Snap>(`/v1/timer/${id}/${op}`, { body: {} });
    revalidatePath("/", "layout");
    if (!r.applied) {
      return { data: { ...one(id, r.entry) }, toast: { text: r.entry ? `Already ${r.entry.state} on another device` : "Already stopped on another device" } };
    }
    if (op === "stop" && r.needsTask) {
      return { data: { ...one(id, r.entry, { needsTask: id }) } };
    }
    if (op === "stop" && r.stopped) {
      return {
        data: { ...one(id, null) },
        toast: {
          text: `Logged ${formatDuration(r.stopped.seconds, { withSeconds: r.stopped.seconds < 60 })}`,
          undo: { action: "restoreTimer", payload: { id: r.stopped.id, state: r.stopped.prevState } },
          link: { href: `/time?view=day&edit=${r.stopped.id}`, label: "Edit" },
        },
      };
    }
    if (op === "discard") {
      return { data: { ...one(id, null) }, toast: { text: "Timer discarded", undo: { action: "restoreTimer", payload: { id } } } };
    }
    if (op === "resume" && r.newDay) {
      // Yesterday's entry stopped and a new one started on the same task (06 §2.6).
      const result: TimerResult = { updates: [{ id, timer: null }, ...(r.entry ? [{ id: r.entry.id, timer: r.entry }] : [])], focus: r.entry?.id };
      return {
        data: { ...result },
        toast: { text: "Started a new entry for today. Yesterday's entry was kept." },
      };
    }
    return { data: { ...one(id, r.entry) } };
  });
}

export async function updateTimer(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, "entryId");
    const body: Record<string, unknown> = {};
    if (fd.has("taskId") && str(fd, "taskId")) body.taskId = str(fd, "taskId");
    if (fd.has("note")) body.note = String(fd.get("note") ?? "");
    if (fd.has("billableField")) body.billable = fd.get("billable") === "on";
    const nudge = str(fd, "nudge");
    if (nudge && str(fd, "firstStartedAt")) {
      body.startedAt = new Date(new Date(str(fd, "firstStartedAt")).getTime() + Number(nudge) * 60000).toISOString();
    }
    if (str(fd, "startedAtWall")) body.startedAt = str(fd, "startedAtWall");
    const r = await api<Snap>(`/v1/timer/${id}`, { method: "PATCH", body });
    // Choosing a task to complete a stop (06 §2.7)
    if (str(fd, "thenStop") === "1" && r.entry) {
      const s = await api<Snap>(`/v1/timer/${id}/stop`, { body: {} });
      revalidatePath("/", "layout");
      return {
        data: { ...one(id, null) },
        toast: s.stopped ? { text: `Logged ${formatDuration(s.stopped.seconds)}`, undo: { action: "restoreTimer", payload: { id, state: "paused" } } } : undefined,
      };
    }
    revalidatePath("/", "layout");
    return { data: { ...one(id, r.entry) } };
  });
}
