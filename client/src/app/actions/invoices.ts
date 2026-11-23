"use server";

import { formatMoney, parseMoney } from "@paypure/domain";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, bool, run, str } from "@/lib/action";
import { ApiError, api } from "@/server/api";

const emails = (s: string) =>
  s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Builder (S9) → draft. Entries are claimed as soon as the draft exists. */
export async function createDraft(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await run(async () => {
    const currency = str(fd, "currency");
    const fixed = fd
      .getAll("fixedTaskIds")
      .map(String)
      .map((taskId) => {
        const amountMinor = parseMoney(str(fd, `fixed_${taskId}`), currency);
        if (!amountMinor || amountMinor <= 0)
          throw new ApiError(422, "invalid", "Enter an amount above zero for each fixed fee.", {
            [`fixed_${taskId}`]: "Enter an amount",
          });
        return { taskId, amountMinor };
      });
    const res = await api<{ id: string }>("/v1/invoices/drafts", {
      body: {
        clientId: str(fd, "clientId"),
        entryIds: fd.getAll("entryIds").map(String),
        fixed,
        layout: {
          mode: str(fd, "mode") || "per_task",
          showDates: bool(fd, "showDates"),
          showNotes: bool(fd, "showNotes"),
        },
      },
    });
    id = res.id;
    revalidatePath("/", "layout");
  });
  if (id) redirect(`/invoices/${id}`);
  return r;
}

/** Draft / correction autosave: the editor form is submitted with requestSubmit() on debounce. */
export async function saveDraft(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, "invoiceId");
    const payload = JSON.parse(String(fd.get("payload") ?? "{}"));
    const r = await api<{ savedAt: string; taxIdMap: Record<string, string>; lineIds: string[] }>(
      `/v1/invoices/${id}/draft`,
      { method: "PATCH", body: payload },
    );
    return { data: r };
  });
}

export async function updateLines(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const r = await api<{ updated: number }>(`/v1/invoices/${str(fd, "invoiceId")}/update-lines`, {
      body: {},
    });
    revalidatePath(`/invoices/${str(fd, "invoiceId")}`);
    return { toast: { text: `${r.updated} ${r.updated === 1 ? "line" : "lines"} updated` } };
  });
}

export async function deleteDraft(_: ActionState, fd: FormData): Promise<ActionState> {
  let done = false;
  const r = await run(async () => {
    await api(`/v1/invoices/${str(fd, "invoiceId")}`, { method: "DELETE" });
    revalidatePath("/", "layout");
    done = true;
  });
  if (done) redirect("/invoices?tab=drafts");
  return r;
}

/** S12: send / correction / reminder / test, one dialog with its own template. */
export async function sendInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, "invoiceId");
    const kind = str(fd, "kind");
    const to = emails(str(fd, "to"));
    const cc = [...emails(str(fd, "cc")), ...(bool(fd, "copyMe") ? [str(fd, "me")] : [])];
    const send = {
      idempotencyKey: str(fd, "idempotencyKey"),
      to,
      cc,
      subject: str(fd, "subject"),
      message: String(fd.get("message") ?? ""),
      issueDate: str(fd, "issueDate") || undefined,
    };
    if (kind !== "test" && to.length === 0)
      throw new ApiError(422, "invalid", "Add at least one recipient.", { to: "Add an email" });
    if (bool(fd, "saveEmails") && to.length) {
      await api(`/v1/clients/${str(fd, "clientId")}`, {
        method: "PATCH",
        body: { billingEmails: to },
      });
    }
    if (kind === "correction") {
      await api(`/v1/invoices/${id}/correction/approve`, {
        body: { changeSummary: str(fd, "changeSummary"), send },
      });
      revalidatePath("/", "layout");
      return { toast: { text: `Correction sent to ${to.join(", ")}` } };
    }
    const r = await api<{ number?: string; to?: string[] }>(`/v1/invoices/${id}/send`, {
      body: {
        ...send,
        kind: kind === "test" ? "test" : kind === "reminder" ? "reminder" : "invoice",
        to: kind === "test" ? [str(fd, "me")] : to,
      },
    });
    revalidatePath("/", "layout");
    if (kind === "test") return { toast: { text: `Test copy sent to ${str(fd, "me")}` } };
    if (kind === "reminder") return { toast: { text: `Reminder sent for ${r.number}` } };
    return { toast: { text: `${r.number} sent to ${(r.to ?? to).join(", ")}` } };
  });
}

export async function markSent(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const r = await api<{ number: string }>(`/v1/invoices/${str(fd, "invoiceId")}/mark-sent`, {
      body: { issueDate: str(fd, "issueDate") || undefined },
    });
    revalidatePath("/", "layout");
    return { toast: { text: `Marked as sent · ${r.number}` } };
  });
}

export async function correctInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/invoices/${str(fd, "invoiceId")}/correct`, { body: {} });
    revalidatePath("/", "layout");
  });
}

export async function saveCorrectionWithoutSending(
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/invoices/${str(fd, "invoiceId")}/correction/approve`, {
      body: { changeSummary: str(fd, "changeSummary") },
    });
    revalidatePath("/", "layout");
    return { toast: { text: "Correction saved without sending" } };
  });
}

export async function discardCorrection(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/invoices/${str(fd, "invoiceId")}/correction`, { method: "DELETE" });
    revalidatePath("/", "layout");
    return { toast: { text: "Correction discarded" } };
  });
}

export async function refreshDetails(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/invoices/${str(fd, "invoiceId")}/correction/refresh-details`, { body: {} });
    revalidatePath(`/invoices/${str(fd, "invoiceId")}`);
  });
}

export async function voidInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const r = await api<{ released: number }>(`/v1/invoices/${str(fd, "invoiceId")}/void`, {
      body: { reason: str(fd, "reason") || undefined },
    });
    revalidatePath("/", "layout");
    return {
      toast: { text: r.released ? `Voided. ${r.released} entries are unbilled again.` : "Voided" },
    };
  });
}

export async function duplicateInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await run(async () => {
    const res = await api<{ id: string; hadTime: boolean }>(
      `/v1/invoices/${str(fd, "invoiceId")}/duplicate`,
      { body: {} },
    );
    id = `${res.id}${res.hadTime ? "?copied=1" : ""}`;
    revalidatePath("/", "layout");
  });
  if (id) redirect(`/invoices/${id}`);
  return r;
}

export async function recordPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, "invoiceId");
    const currency = str(fd, "currency");
    const amountMinor = parseMoney(str(fd, "amount"), currency);
    if (!amountMinor || amountMinor <= 0)
      throw new ApiError(422, "invalid", "Enter the amount received.", {
        amount: "Enter an amount",
      });
    const kind = str(fd, "kind") === "refund" ? "refund" : "payment";
    const r = await api<{ id: string; overpaidMinor: number }>(`/v1/invoices/${id}/payments`, {
      body: {
        kind,
        amountMinor,
        receivedOn: str(fd, "receivedOn"),
        method: str(fd, "method") || "bank_transfer",
        note: str(fd, "note") || undefined,
        thankYou: bool(fd, "thankYou"),
      },
    });
    revalidatePath("/", "layout");
    return {
      toast: {
        text: `${kind === "refund" ? "Refund" : "Payment"} of ${formatMoney({ minor: amountMinor, currency })} recorded${r.overpaidMinor ? ` · overpaid ${formatMoney({ minor: r.overpaidMinor, currency })}` : ""}`,
        undo: { action: "restorePayment", payload: { invoiceId: id, id: r.id } },
      },
    };
  });
}

export async function removePayment(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const id = str(fd, "invoiceId");
    await api(`/v1/invoices/${id}/payments/${str(fd, "paymentId")}`, { method: "DELETE" });
    revalidatePath("/", "layout");
    return {
      toast: {
        text: "Payment removed",
        undo: { action: "restorePayment", payload: { invoiceId: id, id: str(fd, "paymentId") } },
      },
    };
  });
}

export async function addInvoiceNote(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/invoices/${str(fd, "invoiceId")}/notes`, { body: { text: str(fd, "text") } });
    revalidatePath(`/invoices/${str(fd, "invoiceId")}`);
  });
}

export async function regenerateLink(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/invoices/${str(fd, "invoiceId")}/regenerate-link`, { body: {} });
    revalidatePath(`/invoices/${str(fd, "invoiceId")}`);
    return { toast: { text: "New link created. The old one no longer works." } };
  });
}

export async function retryEmail(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/invoices/${str(fd, "invoiceId")}/emails/${str(fd, "emailId")}/retry`, {
      body: {},
    });
    revalidatePath(`/invoices/${str(fd, "invoiceId")}`);
    return { toast: { text: "Queued again" } };
  });
}
