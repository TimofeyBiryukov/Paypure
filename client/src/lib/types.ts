export interface CatalogTask {
  id: string;
  name: string;
  billingMode: "hourly" | "fixed" | "non_billable";
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  colour: number;
}

export interface Catalog {
  tasks: CatalogTask[];
  recentTaskIds: string[];
  clients: { id: string; name: string; colour: number }[];
}

export interface TimerSnapshot {
  id: string;
  state: "running" | "paused" | "stopped";
  date: string;
  timeZone: string;
  note: string;
  billable: boolean;
  version: number;
  task: { id: string; name: string; billingMode: string; projectName: string; clientName: string; colour: number } | null;
  segments: { startedAt: string; endedAt: string | null }[];
  workedSecondsClosed: number;
  openSince: string | null;
  firstStartedAt: string | null;
}

/** One timer changed: `timer` null (or stopped) removes it from the pill (06 §4.3). */
export interface TimerUpdate {
  id: string;
  timer: TimerSnapshot | null;
}

/** `data` of every timer Server Action. Timers run in parallel, so results name their entries. */
export interface TimerResult {
  updates: TimerUpdate[];
  /** expand this timer in the popover (just started, or already running on that task) */
  focus?: string;
  /** start found a live timer on that task and returned it instead of starting another */
  existing?: boolean;
  /** this timer was paused by a stop and needs a task (06 §2.7) */
  needsTask?: string;
}
