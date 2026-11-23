"use server";

import { addDays, formatDuration, fromWallTime, isValidTimeZone, parseDuration, parseTimeOfDay } from "@paypure/domain";
import { revalidatePath } from "next/cache";
import { type ActionState, bool, run, str } from "@/lib/action";
import { api, ApiError, displayTz } from "@/server/api";

function wall(date: string, input: string, tz: string, field: string) {
  const hhmm = parseTimeOfDay(input);
  if (!hhmm) throw new ApiError(422, "invalid", "Check the times.", { [field]: "Use a time like 9, 930 or 9:30p" });
  const r = fromWallTime(date, hhmm, tz);
  if (!r.ok) throw new ApiError(422, "invalid", "That time doesn't exist on this date.", { [field]: `${hhmm} doesn't exist (clocks go forward) → ${r.suggestion}?` });
  return r.instant;
}

/** Entry panel save (S3). Wall times are converted in the entry's own zone (06 §3.5). */
export async function saveEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, "id");
    const tz = str(fd, "entryTz") && isValidTimeZone(str(fd, "entryTz")) ? str(fd, "entryTz") : ((await displayTz()) ?? "UTC");
    const date = str(fd, "date");
    const mode = str(fd, "mode");
    const body: Record<string, unknown> = {
      taskId: str(fd, "taskId"),
      date,
      tz,
      note: String(fd.get("note") ?? ""),
      billable: fd.has("billableField") ? bool(fd, "billable") : undefined,
      version: str(fd, "version") ? Number(str(fd, "version")) : undefined,
      memberId: str(fd, "memberId") || undefined,
    };
    if (!body.taskId) throw new ApiError(422, "invalid", "Choose a task.", { taskId: "Choose a task" });
    if (mode === "duration") {
      const secs = parseDuration(str(fd, "duration"));
      if (!secs) throw new ApiError(422, "invalid", "Check the duration.", { duration: "Use 1.5, 1h30, 90m or 1:30" });
      body.durationSeconds = secs;
    } else {
      const segCount = Number(str(fd, "segCount") || "0");
      const segments: { startedAt: string; endedAt: string }[] = [];
      if (segCount > 1) {
        // Segments edited one by one (06 §2.9); each end after its start, next day when it wraps.
        let day = date;
        let prev: Date | null = null;
        for (let i = 0; i < segCount; i++) {
          let s = wall(day, str(fd, `segStart${i}`), tz, `segStart${i}`);
          if (prev && s < prev) {
            day = addDays(day, 1);
            s = wall(day, str(fd, `segStart${i}`), tz, `segStart${i}`);
          }
          let e = wall(day, str(fd, `segEnd${i}`), tz, `segEnd${i}`);
          if (e <= s) {
            day = addDays(day, 1);
            e = wall(day, str(fd, `segEnd${i}`), tz, `segEnd${i}`);
          }
          segments.push({ startedAt: s.toISOString(), endedAt: e.toISOString() });
          prev = e;
        }
      } else {
        const s = wall(date, str(fd, "start"), tz, "start");
        let e = wall(date, str(fd, "end"), tz, "end");
        // End before start means the next day (+1), in calendar terms (06 §3.5)
        if (e <= s) e = wall(addDays(date, 1), str(fd, "end"), tz, "end");
        segments.push({ startedAt: s.toISOString(), endedAt: e.toISOString() });
      }
      body.segments = segments;
    }
    if (id) {
      const r = await api<{ staged?: boolean; invoiceNumber?: string; invoiceId?: string; onDraft?: boolean }>(`/v1/time-entries/${id}`, { method: "PATCH", body });
      revalidatePath("/", "layout");
      if (r.staged) {
        return { toast: { text: `Change added to the correction for ${r.invoiceNumber}`, link: { href: `/invoices/${r.invoiceId}`, label: "Review" } } };
      }
      return { toast: { text: r.onDraft ? "Saved. The draft's lines are out of date." : "Saved" } };
    }
    const r = await api<{ id: string }>("/v1/time-entries", { body });
    revalidatePath("/", "layout");
    const secs = (body.durationSeconds as number | undefined) ?? (body.segments as { startedAt: string; endedAt: string }[]).reduce((a, s) => a + (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000, 0);
    return { data: { id: r.id }, toast: { text: `Logged ${formatDuration(secs)}`, undo: { action: "restoreEntry", payload: { id: r.id } } } };
  });
}

export async function deleteEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, "id");
    await api(`/v1/time-entries/${id}`, { method: "DELETE" });
    revalidatePath("/", "layout");
    return { toast: { text: "Time entry deleted", undo: { action: "restoreEntry", payload: { id } } } };
  });
}

export async function duplicateEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/time-entries/${str(fd, "id")}/duplicate`, { body: {} });
    revalidatePath("/", "layout");
    return { toast: { text: "Duplicated" } };
  });
}

/** Bulk bar (S2) and Take off unbilled (D10). */
export async function bulkTime(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ids = fd.getAll("entryIds").map(String);
    if (ids.length === 0) throw new ApiError(422, "invalid", "Select some entries first.");
    const op = str(fd, "op");
    if (op === "written_off" || op === "billed_elsewhere") {
      const r = await api<{ count: number }>("/v1/time-entries/off-invoice", { body: { entryIds: ids, kind: op, ref: str(fd, "ref") || undefined } });
      revalidatePath("/", "layout");
      return { toast: { text: `${r.count} ${r.count === 1 ? "entry" : "entries"} ${op === "written_off" ? "written off" : "marked billed elsewhere"}`, undo: { action: "restoreUnbilled", payload: { ids: ids.join(",") } } } };
    }
    if (op === "restore_unbilled") {
      const r = await api<{ count: number }>("/v1/time-entries/off-invoice", { body: { entryIds: ids, kind: null } });
      revalidatePath("/", "layout");
      return { toast: { text: `${r.count} restored to unbilled` } };
    }
    const action = op === "move" ? "move" : op;
    const r = await api<{ count: number; skipped: number }>("/v1/time-entries/bulk", { body: { entryIds: ids, action, taskId: str(fd, "taskId") || undefined } });
    revalidatePath("/", "layout");
    return { toast: { text: `${r.count} updated${r.skipped ? ` · ${r.skipped} skipped (billed or running)` : ""}` } };
  });
}
