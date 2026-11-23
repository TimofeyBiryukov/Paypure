"use server";

import { parseMoney, parsePercentBp } from "@paypure/domain";
import { revalidatePath } from "next/cache";
import { type ActionState, bool, run, str } from "@/lib/action";
import { api, ApiError } from "@/server/api";

const done = () => revalidatePath("/settings", "layout");

/** Business profile and invoicing defaults share one endpoint; each form sends its own fields. */
export async function updateWorkspace(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const body: Record<string, unknown> = {};
    for (const k of ["businessName", "senderName", "address", "phone", "taxId", "billingEmail", "currency", "timeZone", "numberFormat", "defaultNotes", "name"]) {
      if (fd.has(k)) body[k] = str(fd, k);
    }
    if (fd.has("numberReset")) body.numberReset = str(fd, "numberReset");
    if (fd.has("defaultTermsDays")) body.defaultTermsDays = Number(str(fd, "defaultTermsDays") || 0);
    if (fd.has("nextNumber") && str(fd, "nextNumber")) body.nextNumber = Number(str(fd, "nextNumber"));
    if (fd.has("defaultRate")) {
      const raw = str(fd, "defaultRate");
      if (!raw) body.defaultRateMinor = null;
      else {
        const minor = parseMoney(raw, str(fd, "currency") || str(fd, "rateCurrency") || "EUR");
        if (minor == null || minor < 0) throw new ApiError(422, "invalid", "Check the default rate.", { defaultRate: "Enter an amount like 90 or 90.50" });
        body.defaultRateMinor = minor;
      }
    }
    await api("/v1/settings/workspace", { method: "PATCH", body });
    done();
    return { toast: { text: "Settings saved" } };
  });
}

export async function addTax(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const rateBp = parsePercentBp(str(fd, "rate"));
    if (rateBp == null) throw new ApiError(422, "invalid", "Enter a percentage like 10 or 7.7.", { rate: "Enter a percentage" });
    await api("/v1/settings/taxes", { body: { name: str(fd, "name"), rateBp } });
    done();
  });
}

export async function removeTax(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/settings/taxes/${str(fd, "id")}`, { method: "DELETE" });
    done();
    return { toast: { text: "Tax removed. Existing invoices keep their taxes." } };
  });
}

export async function updateTemplate(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/settings/templates/${str(fd, "kind")}`, { method: "PATCH", body: { subject: str(fd, "subject"), body: String(fd.get("body") ?? "") } });
    done();
    return { toast: { text: "Template saved" } };
  });
}

function accountBody(fd: FormData) {
  const opt = (k: string) => str(fd, k) || null;
  return {
    currency: str(fd, "currency"),
    label: str(fd, "label"),
    beneficiaryName: str(fd, "beneficiaryName"),
    beneficiaryAddress: str(fd, "beneficiaryAddress"),
    bankName: str(fd, "bankName"),
    bankAddress: str(fd, "bankAddress"),
    accountNumber: opt("accountNumber"),
    iban: opt("iban"),
    swiftBic: opt("swiftBic"),
    routingNumber: opt("routingNumber"),
    correspondentBankName: opt("correspondentBankName"),
    correspondentAccount: opt("correspondentAccount"),
    correspondentSwift: opt("correspondentSwift"),
    referenceHint: opt("referenceHint"),
    instructions: opt("instructions"),
    isDefault: bool(fd, "isDefault"),
  };
}

export async function addAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api("/v1/settings/accounts", { body: accountBody(fd) });
    done();
    return { toast: { text: "Payment account added" } };
  });
}

export async function updateAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/settings/accounts/${str(fd, "id")}`, { method: "PATCH", body: accountBody(fd) });
    done();
    return { toast: { text: "Account saved. Sent invoices keep the details they were sent with." } };
  });
}

export async function makeDefaultAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/settings/accounts/${str(fd, "id")}`, { method: "PATCH", body: { isDefault: true } });
    done();
  });
}

export async function removeAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const r = await api<{ archived?: boolean }>(`/v1/settings/accounts/${str(fd, "id")}`, { method: "DELETE" });
    done();
    return { toast: { text: r.archived ? "Account archived. Sent invoices keep their details." : "Account deleted" } };
  });
}

export async function inviteMember(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const r = await api<{ inviteUrl: string }>("/v1/settings/members", {
      body: { name: str(fd, "name"), email: str(fd, "email"), role: str(fd, "role") || "member" },
    });
    done();
    return { data: { inviteUrl: r.inviteUrl }, toast: { text: "Invite created. Copy the link below." } };
  });
}

export async function deactivateMember(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await api(`/v1/settings/members/${str(fd, "id")}/deactivate`, { body: {} });
    done();
    return { toast: { text: "Member deactivated. Their time is kept." } };
  });
}

export async function updateProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const body: Record<string, unknown> = {
      name: str(fd, "name"),
      timeZone: str(fd, "timeZone"),
      timeFormat: str(fd, "timeFormat"),
      weekStart: Number(str(fd, "weekStart") || 1),
    };
    const pw = String(fd.get("password") ?? "");
    if (pw) {
      if (pw !== String(fd.get("password2") ?? "")) throw new ApiError(422, "invalid", "The passwords don't match.", { password2: "Doesn't match" });
      body.password = pw;
    }
    await api("/v1/settings/profile", { method: "PATCH", body });
    revalidatePath("/", "layout");
    return { toast: { text: "Profile saved" } };
  });
}
