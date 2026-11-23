"use server";

import { revalidatePath } from "next/cache";
import { type ActionState, run, str } from "@/lib/action";
import { api } from "@/server/api";

/** Undo targets for toasts (Guide §5.14: reversible actions get undo). */
export async function restoreEntry(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/time-entries/${str(fd, "id")}/restore`, { body: {} });
    revalidatePath("/", "layout");
  });
}

export async function restoreTimer(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/timer/${str(fd, "id")}/restore`, {
      body: { state: str(fd, "state") || undefined, discardId: str(fd, "discardId") || undefined },
    });
    revalidatePath("/", "layout");
  });
}

export async function restorePayment(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/invoices/${str(fd, "invoiceId")}/payments/${str(fd, "id")}/restore`, {
      body: {},
    });
    revalidatePath("/", "layout");
  });
}

export async function restoreUnbilled(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api("/v1/time-entries/off-invoice", {
      body: { entryIds: str(fd, "ids").split(","), kind: null },
    });
    revalidatePath("/", "layout");
  });
}

export async function unarchiveClient(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/clients/${str(fd, "id")}/restore`, { body: {} });
    revalidatePath("/", "layout");
  });
}

export async function undoneTask(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/tasks/${str(fd, "id")}`, { method: "PATCH", body: { done: false } });
    revalidatePath("/", "layout");
  });
}
