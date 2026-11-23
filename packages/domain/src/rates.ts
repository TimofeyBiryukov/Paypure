import { formatMoney } from "./money";

export type BillingMode = "hourly" | "fixed" | "non_billable";
export type RateSource = "task" | "project" | "client" | "workspace";

export interface RateChain {
  taskRateMinor: number | null;
  projectRateMinor: number | null;
  clientRateMinor: number | null;
  clientCurrency: string;
  workspaceRateMinor: number | null;
  workspaceCurrency: string;
}

export interface ResolvedRate {
  rateMinor: number;
  source: RateSource;
}

/**
 * task → project → client → workspace (Brief §7.2, 07 §2.1). The workspace default only applies
 * when the client's currency is the workspace currency (M10). A rate of 0 is a real rate.
 */
export function resolveRate(c: RateChain): ResolvedRate | null {
  if (c.taskRateMinor != null) return { rateMinor: c.taskRateMinor, source: "task" };
  if (c.projectRateMinor != null) return { rateMinor: c.projectRateMinor, source: "project" };
  if (c.clientRateMinor != null) return { rateMinor: c.clientRateMinor, source: "client" };
  if (c.workspaceRateMinor != null && c.clientCurrency === c.workspaceCurrency) {
    return { rateMinor: c.workspaceRateMinor, source: "workspace" };
  }
  return null;
}

/** Rate pill text (Guide §5.6). */
export function ratePill(
  mode: BillingMode,
  currency: string,
  resolved: ResolvedRate | null,
  fixed?: { amountMinor: number; billedMinor: number },
): { text: string; tone: "neutral" | "warning" } {
  if (mode === "non_billable") return { text: "Non-billable", tone: "neutral" };
  if (mode === "fixed" && fixed) {
    const fee = formatMoney({ minor: fixed.amountMinor, currency });
    if (fixed.billedMinor <= 0) return { text: `${fee} fixed`, tone: "neutral" };
    if (fixed.billedMinor >= fixed.amountMinor) return { text: `${fee} fixed · billed`, tone: "neutral" };
    return {
      text: `${fee} fixed · ${formatMoney({ minor: fixed.billedMinor, currency })} billed`,
      tone: "neutral",
    };
  }
  if (!resolved) return { text: "No rate", tone: "warning" };
  const r = `${formatMoney({ minor: resolved.rateMinor, currency })}/h`;
  return { text: resolved.source === "task" ? r : `${r} · from ${resolved.source}`, tone: "neutral" };
}

/** 07 §4.2: remaining fee, never negative. */
export function unbilledFixed(feeMinor: number, billedMinor: number): number {
  return Math.max(feeMinor - billedMinor, 0);
}
