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
