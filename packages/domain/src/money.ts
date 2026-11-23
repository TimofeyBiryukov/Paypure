import { exponentOf } from "./currency";

/** Money on the wire: integer minor units plus an ISO currency (07 §1). */
export interface Money {
  minor: number;
  currency: string;
}

/**
 * Round half away from zero (07 §6, M2). For positive values this is Paydirt's half-up.
 * Guards against binary noise such as 19077.499999999996 by snapping to 1e-9 first.
 */
export function roundHalfAway(value: number): number {
  const snapped = Math.round(value * 1e9) / 1e9;
  const r = Math.sign(snapped) * Math.round(Math.abs(snapped));
  return r === 0 ? 0 : r; // no -0
}

/** Step 3: line amount = round(qty_hundredths × rate_minor / 100). */
export function lineAmount(qtyHundredths: number, rateMinor: number): number {
  return roundHalfAway((qtyHundredths * rateMinor) / 100);
}

/** Percentage of an amount in basis points, rounded once (steps 4–5). */
export function percentOf(amountMinor: number, bp: number): number {
  return roundHalfAway((amountMinor * bp) / 10000);
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, locale: string, withCode: boolean): Intl.NumberFormat {
  const key = `${currency}|${locale}|${withCode}`;
  let f = formatterCache.get(key);
  if (!f) {
    const exp = exponentOf(currency);
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    });
    formatterCache.set(key, f);
  }
  return f;
}

/** The one money formatter (Tech §6.3). `withCode` appends the ISO code (documents, mixed views). */
export function formatMoney(
  money: Money,
  opts: { locale?: string; withCode?: boolean } = {},
): string {
  const exp = exponentOf(money.currency);
  const s = formatter(money.currency, opts.locale ?? "en-US", false).format(
    money.minor / 10 ** exp,
  );
  return opts.withCode ? `${s} ${money.currency}` : s;
}

/** Plain number without symbol, e.g. for inputs: 1234.5 → "1234.50". */
export function minorToDecimalString(minor: number, currency: string): string {
  const exp = exponentOf(currency);
  if (exp === 0) return String(minor);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** exp);
  const frac = String(abs % 10 ** exp).padStart(exp, "0");
  return `${sign}${whole}.${frac}`;
}

/**
 * Parse user input ("1,234.5", "90", "€90.00") into minor units without floats.
 * Returns null when it isn't a number or has more decimals than the currency allows.
 */
export function parseMoney(input: string, currency: string): number | null {
  const exp = exponentOf(currency);
  const cleaned = input.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === "" || cleaned === "-" || cleaned === ".") {
    return null;
  }
  const negative = cleaned.startsWith("-");
  const [wholeRaw, fracRaw = ""] = cleaned.replace("-", "").split(".");
  if (fracRaw.length > exp) return null;
  const whole = Number(wholeRaw || "0");
  const frac = Number(fracRaw.padEnd(exp, "0") || "0");
  const minor = whole * 10 ** exp + frac;
  if (!Number.isSafeInteger(minor) || minor > 2147483647) return null;
  return negative ? -minor : minor;
}

/** Percent input ("10", "7.7") → basis points. */
export function parsePercentBp(input: string): number | null {
  const cleaned = input.replace(/[%\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [w, f = ""] = cleaned.split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

export function formatPercentBp(bp: number): string {
  const s = (bp / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${s}%`;
}

/** Group sums by currency; never add different currencies (Guide §5.7). */
export function sumByCurrency(items: Money[]): Money[] {
  const map = new Map<string, number>();
  for (const m of items) map.set(m.currency, (map.get(m.currency) ?? 0) + m.minor);
  return [...map.entries()]
    .map(([currency, minor]) => ({ currency, minor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
