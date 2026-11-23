"use client";

import {
  formatDuration,
  formatMoney,
  parseDuration,
  parseTimeOfDay,
  toLocalTime,
} from "@paypure/domain";
import { X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { deleteEntry, duplicateEntry, saveEntry } from "@/app/actions/time";
import type { EntryRow } from "@/lib/time";
import type { Catalog } from "@/lib/types";
import { Submit } from "./submit";
import { TaskPicker } from "./task-picker";
import { ActionForm, FieldError } from "./toaster";

/**
 * Time entry panel (S3), a side panel on desktop and a sheet on mobile. One real form; Enter in
 * a single-line field saves, Enter in the note adds a line, ⌘↵ submits (Guide §7.2).
 */
export function EntryPanel({
  entry,
  catalog,
  tz,
  date,
  isAdmin,
  members,
  defaults,
}: {
  entry: EntryRow | null;
  catalog: Catalog;
  tz: string;
  date: string;
  isAdmin: boolean;
  members: { id: string; name: string }[];
  defaults: { taskId?: string; start?: string; end?: string };
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const zone = entry?.timeZone ?? tz;
  const timed = entry ? !!entry.startedAt : true;
  const [mode, setMode] = useState<"range" | "duration">(
    entry ? (timed ? "range" : "duration") : "range",
  );
  // The mode is explicit and remembered per device (S3); read after mount to avoid a hydration mismatch.
  useEffect(() => {
    if (entry || defaults.start) return;
    try {
      const m = localStorage.getItem("pp_entry_mode");
      if (m === "duration" || m === "range") setMode(m);
    } catch {}
  }, [entry, defaults.start]);
  const [start, setStart] = useState(
    entry?.startedAt
      ? toLocalTime(entry.startedAt, zone)
      : defaults.start
        ? toLocalTime(defaults.start, tz)
        : "",
  );
  const [end, setEnd] = useState(
    entry?.endedAt
      ? toLocalTime(entry.endedAt, zone)
      : defaults.end
        ? toLocalTime(defaults.end, tz)
        : "",
  );
  const [duration, setDuration] = useState(
    entry && !timed ? formatDuration(entry.durationSeconds) : "",
  );
  const [taskMode, setTaskMode] = useState(
    entry?.task?.billingMode ??
      catalog.tasks.find((t) => t.id === defaults.taskId)?.billingMode ??
      "hourly",
  );
  const onIssued = entry?.invoice?.status === "issued";
  const locked = onIssued && !isAdmin;
  const segs = entry?.segments ?? [];
  const multi = mode === "range" && segs.length > 1;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("pp_entry_mode", mode);
    } catch {}
  }, [mode]);

  const close = () => {
    const p = new URLSearchParams(params.toString());
    for (const k of ["edit", "new", "task", "start", "end"]) p.delete(k);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  const ps = parseTimeOfDay(start);
  const pe = parseTimeOfDay(end);
  const pd = parseDuration(duration);
  const rangeSecs =
    ps && pe
      ? (() => {
          const [a, b] = [ps, pe].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
          return ((b - a + 1440) % 1440 || 1440) * 60;
        })()
      : null;
  const overnight = ps && pe && pe <= ps;

  return (
    <dialog ref={ref} className="panel" onClose={close} aria-labelledby="entry-title">
      <div className="flex items-center justify-between px-5 h-14 border-b border-line">
        <h2 id="entry-title" className="t-title-3">
          {entry ? "Edit time entry" : "Add time entry"}
        </h2>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label="Close"
          onClick={() => ref.current?.close()}
        >
          <X size={16} />
        </button>
      </div>
      <div className="p-5 overflow-auto" style={{ maxHeight: "calc(100vh - 56px)" }}>
        {onIssued && (
          <div className="banner mb-4 text-sm">
            <span>
              On {entry?.invoice?.number}.{" "}
              {isAdmin
                ? "Changes go to a correction you review and send."
                : "Ask an admin to change billed time."}
            </span>
            {isAdmin && (
              <Link
                href={`/invoices/${entry?.invoice?.id}`}
                className="ml-auto text-accent font-medium"
              >
                Open invoice
              </Link>
            )}
          </div>
        )}
        {entry?.invoice?.status === "draft" && (
          <div className="banner mb-4 text-sm">
            On a draft invoice. Saving puts its lines out of date until you press Update.
          </div>
        )}
        <ActionForm action={saveEntry} closeDialog className="space-y-4">
          <fieldset disabled={locked} className="space-y-4">
            {entry && <input type="hidden" name="id" value={entry.id} />}
            {entry && <input type="hidden" name="version" value={entry.version} />}
            <input type="hidden" name="entryTz" value={zone} />
            <div>
              <TaskPicker
                tasks={catalog.tasks}
                recent={catalog.recentTaskIds}
                defaultTaskId={entry?.task?.id ?? defaults.taskId}
                required
                autoFocus={!entry}
                onPick={(t) => setTaskMode(t.billingMode)}
              />
              <FieldError name="taskId" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="entry-date">
                  Date
                </label>
                <input
                  id="entry-date"
                  type="date"
                  name="date"
                  className="input"
                  defaultValue={entry?.date ?? date}
                  required
                />
              </div>
              {isAdmin && members.length > 1 && !entry && (
                <div>
                  <label className="label" htmlFor="entry-member">
                    Member
                  </label>
                  <select id="entry-member" name="memberId" className="select" defaultValue="">
                    <option value="">Me</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <fieldset>
              <legend className="label">Time</legend>
              <div className="seg">
                <label>
                  <input
                    type="radio"
                    name="mode"
                    value="range"
                    checked={mode === "range"}
                    onChange={() => setMode("range")}
                  />
                  <span className="px-3 h-8 inline-flex items-center">Start–end</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="mode"
                    value="duration"
                    checked={mode === "duration"}
                    onChange={() => setMode("duration")}
                  />
                  <span className="px-3 h-8 inline-flex items-center">Duration</span>
                </label>
              </div>
            </fieldset>
            {mode === "range" && !multi && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="entry-start">
                    Start
                  </label>
                  <input
                    id="entry-start"
                    name="start"
                    className="input"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    required
                    inputMode="numeric"
                    placeholder="9:00"
                    aria-describedby="start-hint"
                  />
                  <p id="start-hint" className="hint">
                    {start ? (ps ? `→ ${ps}` : "Try 9, 930 or 9:30p") : " "}
                  </p>
                  <FieldError name="start" />
                </div>
                <div>
                  <label className="label" htmlFor="entry-end">
                    End
                  </label>
                  <input
                    id="entry-end"
                    name="end"
                    className="input"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    required
                    inputMode="numeric"
                    placeholder="17:30"
                    aria-describedby="end-hint"
                  />
                  <p id="end-hint" className="hint">
                    {end
                      ? pe
                        ? `→ ${pe}${overnight ? " +1 day" : ""}`
                        : "Try 17, 1730 or 5:30p"
                      : " "}
                  </p>
                  <FieldError name="end" />
                </div>
                <p className="col-span-2 text-muted text-sm">
                  Worked {rangeSecs ? formatDuration(rangeSecs) : "—"}
                </p>
              </div>
            )}
            {multi && (
              <div>
                <input type="hidden" name="segCount" value={segs.length} />
                <p className="text-sm mb-2">
                  Worked <b className="tnum">{formatDuration(entry?.durationSeconds ?? 0)}</b> ·{" "}
                  {segs.length - 1} {segs.length === 2 ? "break" : "breaks"}. Breaks are never
                  billed.
                </p>
                <ol className="space-y-2">
                  {segs.map((s, i) => (
                    <li key={s.startedAt} className="grid grid-cols-[1fr_1fr] gap-2 items-start">
                      <div>
                        <label className="sr-only" htmlFor={`segStart${i}`}>
                          Segment {i + 1} start
                        </label>
                        <input
                          id={`segStart${i}`}
                          name={`segStart${i}`}
                          className="input"
                          defaultValue={toLocalTime(s.startedAt, zone)}
                          required
                        />
                        <FieldError name={`segStart${i}`} />
                      </div>
                      <div>
                        <label className="sr-only" htmlFor={`segEnd${i}`}>
                          Segment {i + 1} end
                        </label>
                        <input
                          id={`segEnd${i}`}
                          name={`segEnd${i}`}
                          className="input"
                          defaultValue={s.endedAt ? toLocalTime(s.endedAt, zone) : ""}
                          required
                        />
                        <FieldError name={`segEnd${i}`} />
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="hint">
                  Each row is a worked stretch; the gaps between rows are breaks. Switch to Duration
                  to drop the breaks.
                </p>
              </div>
            )}
            {mode === "duration" && (
              <div>
                <label className="label" htmlFor="entry-duration">
                  Duration
                </label>
                <input
                  id="entry-duration"
                  name="duration"
                  className="input"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  required
                  placeholder="1:30"
                  aria-describedby="dur-hint"
                />
                <p id="dur-hint" className="hint">
                  {duration ? (pd ? `→ ${formatDuration(pd)}` : "Try 1.5, 1h30, 90m or 1:30") : " "}
                  {entry && segs.length > 1
                    ? ` · Breaks will be removed. ${formatDuration(entry.durationSeconds)} is kept.`
                    : ""}
                </p>
                <FieldError name="duration" />
              </div>
            )}
            <div>
              <label className="label" htmlFor="entry-note">
                Note
              </label>
              <textarea
                id="entry-note"
                name="note"
                className="textarea"
                defaultValue={entry?.note ?? ""}
                maxLength={5000}
                rows={3}
                placeholder="What did you work on? Lists with - work."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
            </div>
            {taskMode === "hourly" ? (
              <label className="flex items-center gap-2">
                <input type="hidden" name="billableField" value="1" />
                <input type="checkbox" name="billable" defaultChecked={entry?.billable ?? true} />
                Billable
                {isAdmin && entry?.rate && entry.task && (
                  <span className="text-muted text-sm">
                    · {formatMoney({ minor: entry.rate.rateMinor, currency: entry.task.currency })}
                    /h from {entry.rate.source}
                    {entry.valueMinor != null
                      ? ` → ${formatMoney({ minor: entry.valueMinor, currency: entry.task.currency })}`
                      : ""}
                  </span>
                )}
              </label>
            ) : (
              <p className="text-muted text-sm">
                {taskMode === "fixed" ? "Covered by the fixed fee" : "Non-billable task"}
              </p>
            )}
          </fieldset>
          <div className="flex items-center gap-2 pt-2">
            {/* Save is the first submit button in DOM order (Guide §7.2 rule 2) */}
            {!locked && (
              <Submit pendingText="Saving…">{onIssued ? "Propose change" : "Save"}</Submit>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => ref.current?.close()}
            >
              Cancel
            </button>
          </div>
        </ActionForm>
        {entry && !locked && (
          <div className="flex gap-2 mt-6 pt-4 border-t border-line">
            <ActionForm action={duplicateEntry} closeDialog>
              <input type="hidden" name="id" value={entry.id} />
              <Submit className="btn btn-ghost btn-sm">Duplicate</Submit>
            </ActionForm>
            {!onIssued && (
              <ActionForm action={deleteEntry} closeDialog>
                <input type="hidden" name="id" value={entry.id} />
                <Submit className="btn btn-ghost btn-sm text-danger">Delete</Submit>
              </ActionForm>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
