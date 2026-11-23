"use server";

import { formatDuration } from "@paypure/domain";
import { revalidatePath } from "next/cache";
import { type ActionState, run, str } from "@/lib/action";
import type { TimerSnapshot } from "@/lib/types";
import { api } from "@/server/api";

type Snap = {
  entry: TimerSnapshot | null;
  applied: boolean;
  needsTask?: boolean;
  newDay?: boolean;
  stopped?: { id: string; seconds: number; prevState: string };
  stoppedEntryId?: string | null;
  stoppedPrevState?: string | null;
};

const label = (e: TimerSnapshot | null) => (e?.task ? `${e.task.clientName} · ${e.task.name}` : "");

/** Timer actions (06 §2.4). Each is a real <form> with a hidden entry id (Guide §7.1). */
export async function startTimer(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const taskId = str(fd, "taskId") || null;
    const when = str(fd, "when");
    const body: Record<string, unknown> = { taskId };
    if (when === "last") body.afterLastEntry = true;
    else if (when) body.offsetSeconds = Number(when) * 60;
    const note = str(fd, "note");
    if (note) body.note = note;
    const r = await api<Snap>("/v1/timer/start", { body });
    revalidatePath("/", "layout");
    return {
      data: { timer: r.entry },
      toast: r.stoppedEntryId
        ? {
            text: `Stopped the previous timer. Started ${label(r.entry) || "a timer"}`,
            undo: {
              action: "restoreTimer",
              payload: {
                id: r.stoppedEntryId,
                state: r.stoppedPrevState ?? "running",
                discardId: r.entry?.id ?? "",
              },
            },
          }
        : undefined,
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
      return {
        data: { timer: r.entry },
        toast: {
          text: r.entry
            ? `Already ${r.entry.state} on another device`
            : "Already stopped on another device",
        },
      };
    }
    if (op === "stop" && r.needsTask) {
      return { data: { timer: r.entry, needsTask: true } };
    }
    if (op === "stop" && r.stopped) {
      return {
        data: { timer: null },
        toast: {
          text: `Logged ${formatDuration(r.stopped.seconds, { withSeconds: r.stopped.seconds < 60 })}`,
          undo: {
            action: "restoreTimer",
            payload: { id: r.stopped.id, state: r.stopped.prevState },
          },
          link: { href: `/time?view=day&edit=${r.stopped.id}`, label: "Edit" },
        },
      };
    }
    if (op === "discard") {
      return {
        data: { timer: null },
        toast: { text: "Timer discarded", undo: { action: "restoreTimer", payload: { id } } },
      };
    }
    if (op === "resume" && r.newDay) {
      return {
        data: { timer: r.entry },
        toast: { text: "Started a new entry for today. Yesterday's entry was kept." },
      };
    }
    return { data: { timer: r.entry } };
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
      body.startedAt = new Date(
        new Date(str(fd, "firstStartedAt")).getTime() + Number(nudge) * 60000,
      ).toISOString();
    }
    if (str(fd, "startedAtWall")) body.startedAt = str(fd, "startedAtWall");
    const r = await api<Snap>(`/v1/timer/${id}`, { method: "PATCH", body });
    // Choosing a task to complete a stop (06 §2.7)
    if (str(fd, "thenStop") === "1" && r.entry) {
      const s = await api<Snap>(`/v1/timer/${id}/stop`, { body: {} });
      revalidatePath("/", "layout");
      return {
        data: { timer: null },
        toast: s.stopped
          ? {
              text: `Logged ${formatDuration(s.stopped.seconds)}`,
              undo: { action: "restoreTimer", payload: { id, state: "paused" } },
            }
          : undefined,
      };
    }
    revalidatePath("/", "layout");
    return { data: { timer: r.entry } };
  });
}
