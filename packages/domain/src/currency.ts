/**
 * Explicit ISO 4217 minor-unit table (07 §1.1, M12). We don't derive exponents from Intl,
 * because browser and Node versions disagree for a few currencies.
 */
export const CURRENCIES = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  CAD: 2,
  AUD: 2,
  ILS: 2,
  PLN: 2,
  CZK: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  JPY: 0,
  KRW: 0,
  HUF: 0,
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrency(code: string): code is CurrencyCode {
  return Object.hasOwn(CURRENCIES, code);
}

export function exponentOf(code: string): number {
  if (!isCurrency(code)) throw new Error(`Unsupported currency ${code}`);
  return CURRENCIES[code];
}
