"use server";

import { parseDuration, parseMoney } from "@paypure/domain";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, run, str } from "@/lib/action";
import { ApiError, api } from "@/server/api";

/** Money field → minor units, or null when empty. Throws a field error when unreadable. */
function money(fd: FormData, key: string, currency: string): number | null {
  const raw = str(fd, key);
  if (!raw) return null;
  const v = parseMoney(raw, currency);
  if (v == null || v < 0)
    throw new ApiError(422, "invalid", "Some fields need attention.", {
      [key]: "Enter an amount like 90 or 90.50",
    });
  return v;
}

function hours(fd: FormData, key: string): number | null {
  const raw = str(fd, key);
  if (!raw) return null;
  const v = parseDuration(raw);
  if (v == null)
    throw new ApiError(422, "invalid", "Some fields need attention.", {
      [key]: "Enter hours like 12, 1.5 or 1h30",
    });
  return v;
}

function emails(fd: FormData): string[] {
  return str(fd, "billingEmails")
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

function clientBody(fd: FormData, currency: string) {
  const body: Record<string, unknown> = {
    name: str(fd, "name"),
    billingEmails: emails(fd),
    rateMinor: money(fd, "rate", currency),
  };
  for (const k of ["contactName", "address", "taxId", "notes"]) if (fd.has(k)) body[k] = str(fd, k);
  if (fd.has("termsDays"))
    body.termsDays = str(fd, "termsDays") ? Number(str(fd, "termsDays")) : null;
  if (str(fd, "colour")) body.colour = Number(str(fd, "colour"));
  if (str(fd, "currency")) body.currency = str(fd, "currency");
  return body;
}

export async function createClient(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await run(async () => {
    const currency = str(fd, "currency");
    const res = await api<{ id: string }>("/v1/clients", { body: clientBody(fd, currency) });
    id = res.id;
    revalidatePath("/", "layout");
  });
  // S6: lands on the client page with "Add a project" ready.
  if (id) redirect(`/clients/${id}?tab=projects`);
  return r;
}

export async function updateClient(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, "id");
    const currency = str(fd, "currency") || str(fd, "currentCurrency");
    await api(`/v1/clients/${id}`, { method: "PATCH", body: clientBody(fd, currency) });
    revalidatePath("/", "layout");
    return { toast: { text: "Client saved" } };
  });
}

export async function archiveClient(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, "id");
    await api(`/v1/clients/${id}/archive`, { body: {} });
    revalidatePath("/", "layout");
    return {
      toast: { text: "Client archived", undo: { action: "unarchiveClient", payload: { id } } },
    };
  });
}

export async function restoreClient(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/clients/${str(fd, "id")}/restore`, { body: {} });
    revalidatePath("/", "layout");
    return { toast: { text: "Client restored" } };
  });
}

export async function deleteClient(_: ActionState, fd: FormData): Promise<ActionState> {
  let done = false;
  const r = await run(async () => {
    await api(`/v1/clients/${str(fd, "id")}`, { method: "DELETE" });
    revalidatePath("/", "layout");
    done = true;
  });
  if (done) redirect("/clients");
  return r;
}

export async function duplicateInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await run(async () => {
    const res = await api<{ id: string }>(`/v1/invoices/${str(fd, "invoiceId")}/duplicate`, {
      body: {},
    });
    id = res.id;
    revalidatePath("/", "layout");
  });
  if (id) redirect(`/invoices/${id}`);
  return r;
}

export async function createProject(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await run(async () => {
    const res = await api<{ id: string }>("/v1/projects", {
      body: {
        clientId: str(fd, "clientId"),
        name: str(fd, "name"),
        rateMinor: money(fd, "rate", str(fd, "currency")),
      },
    });
    id = res.id;
    revalidatePath("/", "layout");
  });
  if (id) redirect(`/projects/${id}`);
  return r;
}

export async function updateProject(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const currency = str(fd, "currency");
    const kind = str(fd, "budgetKind");
    let budgetValue: number | null = null;
    if (kind === "hours") budgetValue = hours(fd, "budgetValue");
    if (kind === "money") budgetValue = money(fd, "budgetValue", currency);
    await api(`/v1/projects/${str(fd, "id")}`, {
      method: "PATCH",
      body: {
        name: str(fd, "name"),
        rateMinor: money(fd, "rate", currency),
        budgetKind: kind && budgetValue != null ? kind : null,
        budgetValue: kind ? budgetValue : null,
        status: str(fd, "status") || undefined,
        notes: str(fd, "notes"),
      },
    });
    revalidatePath("/", "layout");
    return { toast: { text: "Project saved" } };
  });
}

export async function createTask(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api("/v1/tasks", { body: { projectId: str(fd, "projectId"), name: str(fd, "name") } });
    revalidatePath("/", "layout");
  });
}

export async function updateTask(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const currency = str(fd, "currency");
    const mode = str(fd, "billingMode") as "hourly" | "fixed" | "non_billable";
    const body: Record<string, unknown> = {
      name: str(fd, "name"),
      billingMode: mode,
      estimateSeconds: hours(fd, "estimate"),
    };
    if (mode === "hourly") body.rateMinor = money(fd, "rate", currency);
    if (mode === "fixed") {
      const fee = money(fd, "fixedAmount", currency);
      if (!fee)
        throw new ApiError(422, "invalid", "Some fields need attention.", {
          fixedAmount: "Enter the fee",
        });
      body.fixedAmountMinor = fee;
    }
    await api(`/v1/tasks/${str(fd, "id")}`, { method: "PATCH", body });
    revalidatePath("/", "layout");
    return { toast: { text: "Task saved" } };
  });
}

export async function toggleTaskDone(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, "id");
    const done = str(fd, "done") === "1";
    await api(`/v1/tasks/${id}`, { method: "PATCH", body: { done } });
    revalidatePath("/", "layout");
    return done
      ? { toast: { text: "Task marked done", undo: { action: "undoneTask", payload: { id } } } }
      : { toast: { text: "Task reopened" } };
  });
}

export async function deleteTask(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/tasks/${str(fd, "id")}`, { method: "DELETE" });
    revalidatePath("/", "layout");
    return { toast: { text: "Task deleted" } };
  });
}
