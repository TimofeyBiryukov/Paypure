import { type CalendarDate, daysBetween } from "./time";

export type InvoiceStatus = "draft" | "issued" | "void";
export type ChipTone = "neutral" | "info" | "warning" | "danger" | "success" | "void";

export interface DisplayStatus {
  key: "draft" | "sent" | "partially_paid" | "overdue" | "paid" | "void";
  label: string;
  tone: ChipTone;
  overdueDays?: number;
  overpaidMinor?: number;
  balanceMinor: number;
  netPaidMinor: number;
}

/**
 * The one function that picks the chip (08 §2.1, Guide §5.5). Order: void → draft → paid
 * (incl. overpaid) → overdue · Nd → partially paid → sent. `today` is in the workspace zone.
 */
export function displayStatus(input: {
  status: InvoiceStatus;
  totalMinor: number;
  netPaidMinor: number;
  dueDate: CalendarDate | null;
  today: CalendarDate;
}): DisplayStatus {
  const balanceMinor = input.totalMinor - input.netPaidMinor;
  const base = { balanceMinor, netPaidMinor: input.netPaidMinor };
  if (input.status === "void") return { ...base, key: "void", label: "Void", tone: "void" };
  if (input.status === "draft") return { ...base, key: "draft", label: "Draft", tone: "neutral" };
  if (input.netPaidMinor >= input.totalMinor) {
    const over = input.netPaidMinor - input.totalMinor;
    return {
      ...base,
      key: "paid",
      label: "Paid",
      tone: "success",
      ...(over > 0 ? { overpaidMinor: over } : {}),
    };
  }
  if (input.dueDate && input.dueDate < input.today) {
    const days = daysBetween(input.dueDate, input.today);
    return { ...base, key: "overdue", label: `Overdue · ${days}d`, tone: "danger", overdueDays: days };
  }
  if (input.netPaidMinor > 0) {
    return { ...base, key: "partially_paid", label: "Partially paid", tone: "warning" };
  }
  return { ...base, key: "sent", label: "Sent", tone: "info" };
}
