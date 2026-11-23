"use client";

import { formatDuration, formatTime } from "@paypure/domain";
import { Pause, Play, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { startTimer, timerTransition, updateTimer } from "@/app/actions/timer";
import type { ActionState } from "@/lib/action";
import type { Catalog, TimerSnapshot } from "@/lib/types";
import { Submit } from "./submit";
import { TaskPicker } from "./task-picker";
import { ActionForm } from "./toaster";
import { ClientBadge } from "./ui";

export function worked(t: TimerSnapshot, now: number): number {
  const open =
    t.state === "running" && t.openSince
      ? Math.max(0, Math.floor((now - Date.parse(t.openSince)) / 1000))
      : 0;
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

/**
 * Timer pill + popover (Guide §5.12, S4). The ticking clock is client-side; the snapshot comes
 * from the server, from action results, and from live sync (`pp:timer` events, 06 §4).
 */
export function TimerPill({
  initial,
  catalog,
  tz,
  timeFormat,
}: {
  initial: TimerSnapshot | null;
  catalog: Catalog;
  tz: string;
  timeFormat: "12h" | "24h";
}) {
  const [timer, setTimer] = useState<TimerSnapshot | null>(initial);
  const [open, setOpen] = useState(false);
  const [needsTask, setNeedsTask] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = useNow(!!timer);

  useEffect(() => setTimer(initial), [initial]);
  useEffect(() => {
    const on = (e: Event) => setTimer((e as CustomEvent).detail ?? null);
    window.addEventListener("pp:timer", on);
    const toggle = () => setOpen((o) => !o);
    window.addEventListener("pp:timer-toggle", toggle);
    const key = (e: KeyboardEvent) => {
      // ⌥T toggles the timer popover (Guide §6)
      if (e.altKey && e.code === "KeyT") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pp:timer", on);
      window.removeEventListener("pp:timer-toggle", toggle);
      window.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => {
      // composedPath, not contains(): picking a task unmounts the option before this runs,
      // so e.target is already detached and would look like an outside click.
      if (ref.current && !e.composedPath().includes(ref.current)) setOpen(false);
    };
    document.addEventListener("mousedown", click);
    return () => document.removeEventListener("mousedown", click);
  }, [open]);

  const onResult = useCallback((s: ActionState) => {
    const t = (s?.data as { timer?: TimerSnapshot | null } | undefined)?.timer;
    if (t !== undefined) setTimer(t);
    const nt = !!(s?.data as { needsTask?: boolean } | undefined)?.needsTask;
    setNeedsTask(nt);
    if (!nt && t === null) setOpen(false);
    // Tell the other tabs (06 §4.4)
    try {
      new BroadcastChannel("paypure").postMessage({
        topic: "timer",
        timer: t ?? null,
        local: true,
      });
    } catch {}
  }, []);

  const secs = timer ? worked(timer, now) : 0;
  const long = secs > 10 * 3600;
  const paused = timer?.state === "paused";
  const breaks = timer ? Math.max(0, timer.segments.length - 1) : 0;
  const breakSecs =
    timer && timer.segments.length > 1
      ? timer.segments.slice(1).reduce((s, seg, i) => {
          const prevEnd = timer.segments[i].endedAt;
          return prevEnd ? s + (Date.parse(seg.startedAt) - Date.parse(prevEnd)) / 1000 : s;
        }, 0) +
        (paused && timer.segments.at(-1)?.endedAt
          ? (now - Date.parse(timer.segments.at(-1)?.endedAt as string)) / 1000
          : 0)
      : 0;
  const ariaLabel = timer
    ? `Timer ${paused ? "paused" : "running"}, ${formatDuration(secs)}${timer.task ? `, ${timer.task.clientName}, ${timer.task.name}` : ", no task"}`
    : "Start timer";

  return (
    <div ref={ref} className="relative">
      {timer ? (
        <div
          className="flex items-center rounded-full h-9 pl-1 pr-1"
          style={{ background: long ? "var(--warning-bg)" : "var(--accent-soft)" }}
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
              style={{
                background: paused
                  ? "var(--text-faint)"
                  : long
                    ? "var(--warning-fg)"
                    : "var(--accent)",
              }}
            />
            <span
              className={`truncate hidden sm:inline ${!timer.task ? "text-warning font-medium" : ""}`}
            >
              {long
                ? `Running ${Math.floor(secs / 3600)}h · still working?`
                : timer.task
                  ? `${timer.task.clientName} · ${timer.task.name}`
                  : "Choose task…"}
            </span>
            <span className={`tnum font-semibold ${paused ? "text-muted" : ""}`} aria-live="off">
              {formatDuration(secs, { withSeconds: true })}
            </span>
          </button>
          <ActionForm action={timerTransition} onSuccess={onResult} showError={false}>
            <input type="hidden" name="entryId" value={timer.id} />
            {paused && (
              <button
                type="submit"
                name="op"
                value="resume"
                className="btn btn-ghost btn-icon rounded-full"
                aria-label="Resume"
                title="Resume"
              >
                <Play size={14} />
              </button>
            )}
            <button
              type="submit"
              name="op"
              value="stop"
              className="btn btn-ghost btn-icon rounded-full"
              aria-label="Stop"
              title="Stop"
            >
              <Square size={14} fill="currentColor" />
            </button>
          </ActionForm>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <Play size={14} /> <span className="hidden sm:inline">Start timer</span>
        </button>
      )}

      {open && (
        <div
          className="pop absolute right-0 mt-2 w-[min(380px,calc(100vw-24px))] p-4 z-40"
          role="dialog"
          aria-label="Timer"
        >
          {!timer ? (
            <IdlePopover catalog={catalog} onResult={onResult} />
          ) : (
            <RunningPopover
              timer={timer}
              secs={secs}
              breaks={breaks}
              breakSecs={breakSecs}
              catalog={catalog}
              tz={tz}
              timeFormat={timeFormat}
              needsTask={needsTask || (!timer.task && paused)}
              onResult={onResult}
            />
          )}
        </div>
      )}
    </div>
  );
}

function IdlePopover({
  catalog,
  onResult,
}: {
  catalog: Catalog;
  onResult: (s: ActionState) => void;
}) {
  return (
    <ActionForm action={startTimer} onSuccess={onResult} className="space-y-3">
      <TaskPicker
        tasks={catalog.tasks}
        recent={catalog.recentTaskIds}
        autoFocus
        submitOnPick
        label="Start a timer on"
      />
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
  secs,
  breaks,
  breakSecs,
  catalog,
  tz,
  timeFormat,
  needsTask,
  onResult,
}: {
  timer: TimerSnapshot;
  secs: number;
  breaks: number;
  breakSecs: number;
  catalog: Catalog;
  tz: string;
  timeFormat: "12h" | "24h";
  needsTask: boolean;
  onResult: (s: ActionState) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div className="t-display">{formatDuration(secs, { withSeconds: true })}</div>
        {timer.task && <ClientBadge name={timer.task.clientName} colour={timer.task.colour} />}
      </div>

      {needsTask && (
        <div className="banner banner-warning text-sm">
          Choose a task to log {formatDuration(secs)}. The timer is paused meanwhile.
        </div>
      )}

      <ActionForm
        action={updateTimer}
        onSuccess={onResult}
        key={`task-${timer.task?.id ?? "none"}`}
      >
        <input type="hidden" name="entryId" value={timer.id} />
        {needsTask && <input type="hidden" name="thenStop" value="1" />}
        <TaskPicker
          tasks={catalog.tasks}
          recent={catalog.recentTaskIds}
          defaultTaskId={timer.task?.id}
          submitOnPick
          label="Task"
          autoFocus={needsTask}
        />
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
          placeholder="What are you working on?"
          // Autosave submits the form on blur; ⌘↵ submits via requestSubmit (Guide §7.1–7.2)
          onBlur={(e) => {
            if (e.currentTarget.value !== timer.note) e.currentTarget.form?.requestSubmit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
              e.currentTarget.form?.requestSubmit();
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
            <input
              type="checkbox"
              name="billable"
              defaultChecked={timer.billable}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
            />
            Billable
          </label>
          <button type="submit" className="sr-only">
            Save billable
          </button>
        </ActionForm>
      )}

      {timer.firstStartedAt && (
        <ActionForm
          action={updateTimer}
          onSuccess={onResult}
          className="flex items-center gap-1 flex-wrap text-sm"
        >
          <input type="hidden" name="entryId" value={timer.id} />
          <input type="hidden" name="firstStartedAt" value={timer.firstStartedAt} />
          <span className="text-muted mr-1">
            Started {formatTime(timer.firstStartedAt, tz, timeFormat)}
          </span>
          {[-15, -5, 5, 15].map((n) => (
            <button
              key={n}
              type="submit"
              name="nudge"
              value={String(n)}
              className="btn btn-ghost btn-sm"
              aria-label={`Move start ${n} minutes`}
            >
              {n > 0 ? `+${n}` : n}
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
        <Submit
          className="btn btn-primary"
          name="op"
          value="stop"
          disabled={needsTask}
          title={needsTask ? "Choose a task first" : undefined}
        >
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
        <button
          type="submit"
          name="op"
          value="discard"
          className="btn btn-ghost ml-auto text-danger"
          aria-label="Discard timer"
        >
          <Trash2 size={14} /> Discard
        </button>
      </ActionForm>
    </div>
  );
}
