import { type CalendarDate, parseDate } from "./time";

/**
 * Invoice number format (08 §6.1). Tokens: {seq}, {seq:N}, {YYYY}, {YY}. Anything else is literal.
 */
export function formatInvoiceNumber(format: string, seq: number, issueDate: CalendarDate): string {
  const { y } = parseDate(issueDate);
  return format
    .replace(/\{seq(?::(\d+))?\}/g, (_, n) => (n ? String(seq).padStart(Number(n), "0") : String(seq)))
    .replace(/\{YYYY\}/g, String(y))
    .replace(/\{YY\}/g, String(y).slice(-2));
}

export function validateNumberFormat(format: string, reset: "never" | "yearly"): string | null {
  if (!/\{seq(?::\d+)?\}/.test(format)) return "The format must contain {seq} or {seq:N}.";
  if (reset === "yearly" && !/\{YY(YY)?\}/.test(format)) {
    return "A yearly reset needs {YYYY} or {YY} in the format.";
  }
  return null;
}

/** Sequence period: '' when never reset, the year when it resets yearly. */
export function numberPeriod(reset: "never" | "yearly", issueDate: CalendarDate): string {
  return reset === "yearly" ? String(parseDate(issueDate).y) : "";
}
