"use client";

import { formatDuration, formatTime, TIMER_LIMIT } from "@paypure/domain";
import { Pause, Play, Plus, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { startTimer, timerTransition, updateTimer } from "@/app/actions/timer";
import type { ActionState } from "@/lib/action";
import type { Catalog, TimerResult, TimerSnapshot, TimerUpdate } from "@/lib/types";
import { continueNoteList } from "./note-md";
import { Submit } from "./submit";
import { TaskPicker } from "./task-picker";
import { ActionForm } from "./toaster";
import { ClientBadge } from "./ui";

export function worked(t: TimerSnapshot, now: number): number {
  const open = t.state === "running" && t.openSince ? Math.max(0, Math.floor((now - Date.parse(t.openSince)) / 1000)) : 0;
  return t.workedSecondsClosed + open;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [active]);
  return now;
}

/** Apply one timer change to the list (newest first). Null or stopped removes it (06 §4.3). */
export function applyTimer(list: TimerSnapshot[], id: string, snap: TimerSnapshot | null): TimerSnapshot[] {
  if (!snap || snap.state === "stopped") return list.filter((t) => t.id !== id);
  const i = list.findIndex((t) => t.id === id);
  if (i === -1) return [snap, ...list];
  // Ignore snapshots older than what we have (live sync can arrive after the action result).
  if (list[i].version > snap.version) return list;
  return list.map((t) => (t.id === id ? snap : t));
}

const label = (t: TimerSnapshot) => (t.task ? `${t.task.clientName} · ${t.task.name}` : "Choose task…");
const LONG = 10 * 3600;

/**
 * Timer pill + popover (Guide §5.12, S4). A member can run several timers in parallel (06 §2.4):
 * the pill shows the newest running one plus a count, and the popover lists them all. The
 * ticking clocks are client-side; snapshots come from the server, from action results, and from
 * live sync (`pp:timer` events with `{id, timer}`, 06 §4).
 */
export function TimerPill({
  initial,
  catalog,
  tz,
  timeFormat,
}: {
  initial: TimerSnapshot[];
  catalog: Catalog;
  tz: string;
  timeFormat: "12h" | "24h";
}) {
  const [timers, setTimers] = useState<TimerSnapshot[]>(initial);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [needsTask, setNeedsTask] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const now = useNow(timers.some((t) => t.state === "running"));

  useEffect(() => setTimers(initial), [initial]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<TimerUpdate | null>).detail;
      if (d?.id) setTimers((l) => applyTimer(l, d.id, d.timer));
    };
    window.addEventListener("pp:timer", on);
    const toggle = () => setOpen((o) => !o);
    window.addEventListener("pp:timer-toggle", toggle);
    const focus = (e: Event) => {
      setSelected((e as CustomEvent<string>).detail);
      setAdding(false);
      setOpen(true);
    };
    window.addEventListener("pp:timer-focus", focus);
    const key = (e: KeyboardEvent) => {
      // ⌥T toggles the timer popover (Guide §6)
      if (e.altKey && (e.code === "KeyT")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pp:timer", on);
      window.removeEventListener("pp:timer-toggle", toggle);
      window.removeEventListener("pp:timer-focus", focus);
      window.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    if (!open) {
      setAdding(false);
      return;
    }
    const click = (e: MouseEvent) => {
      // composedPath, not contains(): picking a task unmounts the option before this runs,
      // so e.target is already detached and would look like an outside click.
      if (ref.current && !e.composedPath().includes(ref.current)) setOpen(false);
    };
    document.addEventListener("mousedown", click);
    return () => document.removeEventListener("mousedown", click);
  }, [open]);
  // The last live timer stopped: close the popover, as with a single timer.
  const had = useRef(timers.length);
  useEffect(() => {
    if (had.current > 0 && timers.length === 0) setOpen(false);
    had.current = timers.length;
  }, [timers.length]);

  const onResult = useCallback((s: ActionState) => {
    const r = s?.data as TimerResult | undefined;
    if (!r?.updates) return;
    setTimers((l) => r.updates.reduce((acc, u) => applyTimer(acc, u.id, u.timer), l));
    setNeedsTask((cur) => r.needsTask ?? (r.updates.some((u) => u.id === cur) ? null : cur));
    if (r.needsTask) setSelected(r.needsTask);
    if (r.focus) {
      setSelected(r.focus);
      setAdding(false);
    }
    // Tell the other tabs (06 §4.4)
    try {
      const ch = new BroadcastChannel("paypure");
      for (const u of r.updates) ch.postMessage({ topic: "timer", entity: u.id, timer: u.timer, local: true });
      ch.close();
    } catch {}
  }, []);

  // The pill shows the newest running timer, else the newest paused one.
  const shown = timers.find((t) => t.state === "running") ?? timers[0];
  const current = timers.find((t) => t.id === selected) ?? shown;
  const secs = shown ? worked(shown, now) : 0;
  const long = secs > LONG;
  const anyLong = timers.some((t) => worked(t, now) > LONG);
  const paused = shown?.state === "paused";
  const more = timers.length - 1;
  const atLimit = timers.length >= TIMER_LIMIT;
  const ariaLabel = shown
    ? `${timers.length > 1 ? `${timers.length} timers. ` : ""}Timer ${paused ? "paused" : "running"}, ${formatDuration(secs)}${shown.task ? `, ${shown.task.clientName}, ${shown.task.name}` : ", no task"}`
    : "Start timer";

  return (
    <div ref={ref} className="relative">
      {shown ? (
        <div
          className="flex items-center rounded-full h-9 pl-1 pr-1"
          style={{ background: anyLong ? "var(--warning-bg)" : "var(--accent-soft)" }}
        >
          <button
            type="button"
            className="flex items-center gap-2 h-8 px-2 rounded-full focus-ring max-w-[46vw] sm:max-w-[320px]"
            onClick={() => setOpen((o) => !o)}
            aria-label={ariaLabel}
            aria-expanded={open}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${paused ? "" : "pulse"}`}
              style={{ background: paused ? "var(--text-faint)" : long ? "var(--warning-fg)" : "var(--accent)" }}
            />
            <span className={`truncate hidden sm:inline ${!shown.task ? "text-warning font-medium" : ""}`}>
              {long ? `Running ${Math.floor(secs / 3600)}h · still working?` : label(shown)}
            </span>
            <span className={`tnum font-semibold ${paused ? "text-muted" : ""}`} aria-live="off">
              {formatDuration(secs, { withSeconds: true })}
            </span>
            {more > 0 && (
              <span className="t-micro tnum rounded-full px-1.5 py-0.5 bg-surface shrink-0" title={`${timers.length} timers live`}>
                +{more}
              </span>
            )}
          </button>
          <ActionForm action={timerTransition} onSuccess={onResult} showError={false}>
            <input type="hidden" name="entryId" value={shown.id} />
            {paused && (
              <button type="submit" name="op" value="resume" className="btn btn-ghost btn-icon rounded-full" aria-label="Resume" title="Resume">
                <Play size={14} />
              </button>
            )}
            <button type="submit" name="op" value="stop" className="btn btn-ghost btn-icon rounded-full" aria-label="Stop" title="Stop">
              <Square size={14} fill="currentColor" />
            </button>
          </ActionForm>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Play size={14} /> <span className="hidden sm:inline">Start timer</span>
        </button>
      )}

      {open && (
        <div
          className="pop absolute right-0 mt-2 w-[min(380px,calc(100vw-24px))] p-4 z-40"
          role="dialog"
          aria-label="Timers"
        >
          {!current ? (
            <IdlePopover catalog={catalog} onResult={onResult} />
          ) : (
            <div className="space-y-3">
              {timers.length > 1 && (
                <ul className="space-y-1" aria-label="Live timers">
                  {timers.map((t) => (
                    <TimerRow key={t.id} t={t} now={now} selected={t.id === current.id} onSelect={() => setSelected(t.id)} onResult={onResult} />
                  ))}
                </ul>
              )}
              <div className={timers.length > 1 ? "border-t border-line pt-3" : ""}>
                <RunningPopover
                  key={current.id}
                  timer={current}
                  now={now}
                  catalog={catalog}
                  tz={tz}
                  timeFormat={timeFormat}
                  needsTask={needsTask === current.id || (!current.task && current.state === "paused")}
                  onResult={onResult}
                />
              </div>
              <div className="border-t border-line pt-3">
                {adding ? (
                  <IdlePopover catalog={catalog} onResult={onResult} />
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)} disabled={atLimit}>
                    <Plus size={14} /> Start another timer
                  </button>
                )}
                {atLimit && !adding && <p className="t-caption mt-1">{TIMER_LIMIT} timers live · stop one to start another</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One live timer in the popover list: select it to edit, or pause/resume/stop it in place. */
function TimerRow({
  t,
  now,
  selected,
  onSelect,
  onResult,
}: {
  t: TimerSnapshot;
  now: number;
  selected: boolean;
  onSelect: () => void;
  onResult: (s: ActionState) => void;
}) {
  const secs = worked(t, now);
  const paused = t.state === "paused";
  return (
    <li className={`flex items-center gap-1 rounded-md pl-1 ${selected ? "bg-sunken" : ""}`}>
      <button type="button" className="flex-1 min-w-0 flex items-center gap-2 h-9 px-1 text-left focus-ring rounded-md" onClick={onSelect} aria-current={selected || undefined}>
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${paused ? "" : "pulse"}`}
          style={{ background: paused ? "var(--text-faint)" : secs > LONG ? "var(--warning-fg)" : "var(--accent)" }}
        />
        <span className={`truncate flex-1 ${!t.task ? "text-warning font-medium" : ""}`}>{label(t)}</span>
        <span className={`tnum ${paused ? "text-muted" : "font-semibold"}`} aria-live="off">
          {formatDuration(secs, { withSeconds: true })}
        </span>
      </button>
      <ActionForm action={timerTransition} onSuccess={onResult} showError={false} className="flex items-center">
        <input type="hidden" name="entryId" value={t.id} />
        {paused ? (
          <button type="submit" name="op" value="resume" className="btn btn-ghost btn-icon rounded-full" aria-label={`Resume ${label(t)}`} title="Resume">
            <Play size={14} />
          </button>
        ) : (
          <button type="submit" name="op" value="pause" className="btn btn-ghost btn-icon rounded-full" aria-label={`Pause ${label(t)}`} title="Pause">
            <Pause size={14} />
          </button>
        )}
        <button type="submit" name="op" value="stop" className="btn btn-ghost btn-icon rounded-full" aria-label={`Stop ${label(t)}`} title="Stop">
          <Square size={14} fill="currentColor" />
        </button>
      </ActionForm>
    </li>
  );
}

function IdlePopover({ catalog, onResult }: { catalog: Catalog; onResult: (s: ActionState) => void }) {
  return (
    <ActionForm action={startTimer} onSuccess={onResult} className="space-y-3">
      <TaskPicker tasks={catalog.tasks} recent={catalog.recentTaskIds} autoFocus submitOnPick label="Start a timer on" />
      <div className="flex items-center gap-2">
        <Submit className="btn btn-primary">
          <Play size={14} /> Start
        </Submit>
        <details className="menu relative">
          <summary className="btn btn-ghost btn-sm">Start in the past…</summary>
          <div className="menu-body pop">
            {[5, 15, 30, 60].map((m) => (
              <button key={m} type="submit" name="when" value={String(m)} className="menu-item">
                Start {m} min ago
              </button>
            ))}
            <button type="submit" name="when" value="last" className="menu-item">
              Start at end of last entry
            </button>
          </div>
        </details>
      </div>
      <p className="t-caption">You can start without a task and choose it later.</p>
    </ActionForm>
  );
}

function RunningPopover({
  timer,
  now,
  catalog,
  tz,
  timeFormat,
  needsTask,
  onResult,
}: {
  timer: TimerSnapshot;
  now: number;
  catalog: Catalog;
  tz: string;
  timeFormat: "12h" | "24h";
  needsTask: boolean;
  onResult: (s: ActionState) => void;
}) {
  const secs = worked(timer, now);
  const paused = timer.state === "paused";
  const breaks = Math.max(0, timer.segments.length - 1);
  const breakSecs =
    timer.segments.length > 1
      ? timer.segments.slice(1).reduce((s, seg, i) => {
          const prevEnd = timer.segments[i].endedAt;
          return prevEnd ? s + (Date.parse(seg.startedAt) - Date.parse(prevEnd)) / 1000 : s;
        }, 0) + (paused && timer.segments.at(-1)?.endedAt ? (now - Date.parse(timer.segments.at(-1)?.endedAt as string)) / 1000 : 0)
      : 0;
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div className="t-display">{formatDuration(secs, { withSeconds: true })}</div>
        {timer.task && <ClientBadge name={timer.task.clientName} colour={timer.task.colour} />}
      </div>

      {needsTask && (
        <div className="banner banner-warning text-sm">Choose a task to log {formatDuration(secs)}. The timer is paused meanwhile.</div>
      )}

      <ActionForm action={updateTimer} onSuccess={onResult} key={`task-${timer.task?.id ?? "none"}`}>
        <input type="hidden" name="entryId" value={timer.id} />
        {needsTask && <input type="hidden" name="thenStop" value="1" />}
        <TaskPicker tasks={catalog.tasks} recent={catalog.recentTaskIds} defaultTaskId={timer.task?.id} submitOnPick label="Task" autoFocus={needsTask} />
        <button type="submit" className="sr-only">
          Save task
        </button>
      </ActionForm>

      <ActionForm action={updateTimer} onSuccess={onResult} showError={false}>
        <input type="hidden" name="entryId" value={timer.id} />
        <label className="label" htmlFor="timer-note">
          Note
        </label>
        <textarea
          id="timer-note"
          name="note"
          className="textarea"
          defaultValue={timer.note}
          rows={2}
          placeholder="What are you working on? Markdown lists work."
          // Autosave submits the form on blur; ⌘↵ submits via requestSubmit (Guide §7.1–7.2)
          onBlur={(e) => {
            if (e.currentTarget.value !== timer.note) e.currentTarget.form?.requestSubmit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
            else continueNoteList(e);
          }}
        />
        <button type="submit" className="sr-only">
          Save note
        </button>
      </ActionForm>

      {timer.task?.billingMode === "hourly" && (
        <ActionForm action={updateTimer} onSuccess={onResult} showError={false}>
          <input type="hidden" name="entryId" value={timer.id} />
          <input type="hidden" name="billableField" value="1" />
          <label className="flex items-center gap-2">
            <input type="checkbox" name="billable" defaultChecked={timer.billable} onChange={(e) => e.currentTarget.form?.requestSubmit()} />
            Billable
          </label>
          <button type="submit" className="sr-only">
            Save billable
          </button>
        </ActionForm>
      )}

      {timer.firstStartedAt && (
        <ActionForm action={updateTimer} onSuccess={onResult} className="flex items-center gap-1 flex-wrap text-sm">
          <input type="hidden" name="entryId" value={timer.id} />
          <input type="hidden" name="firstStartedAt" value={timer.firstStartedAt} />
          <span className="text-muted mr-1">Started {formatTime(timer.firstStartedAt, tz, timeFormat)}</span>
          {[-15, -5, 5, 15].map((n) => (
            <button key={n} type="submit" name="nudge" value={String(n)} className="btn btn-ghost btn-sm" title={`Move start ${Math.abs(n)} minutes ${n < 0 ? "earlier" : "later"}`} aria-label={`Move start ${Math.abs(n)} minutes ${n < 0 ? "earlier" : "later"}`}>
              {n > 0 ? `+${n}m` : `−${-n}m`}
            </button>
          ))}
          {breaks > 0 && (
            <span className="text-muted ml-auto">
              {breaks} {breaks === 1 ? "break" : "breaks"} · {formatDuration(breakSecs)}
            </span>
          )}
        </ActionForm>
      )}

      <ActionForm action={timerTransition} onSuccess={onResult} className="flex items-center gap-2">
        <input type="hidden" name="entryId" value={timer.id} />
        {/* Stop is the primary action: first submit button in DOM order (Guide §7.2 rule 2) */}
        <Submit className="btn btn-primary" name="op" value="stop" disabled={needsTask} title={needsTask ? "Choose a task first" : undefined}>
          <Square size={14} fill="currentColor" /> Stop
        </Submit>
        {timer.state === "running" ? (
          <button type="submit" name="op" value="pause" className="btn btn-secondary">
            <Pause size={14} /> Pause
          </button>
        ) : (
          <button type="submit" name="op" value="resume" className="btn btn-secondary">
            <Play size={14} /> Resume
          </button>
        )}
        <button type="submit" name="op" value="discard" className="btn btn-ghost ml-auto text-danger" aria-label="Discard timer">
          <Trash2 size={14} /> Discard
        </button>
      </ActionForm>
    </div>
  );
}
