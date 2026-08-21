/**
 * Money primitives for Mastline.
 *
 * Every monetary value in the system is an integer number of minor units
 * (cents for USD) paired with an ISO 4217 currency code. Floating point money
 * never enters the domain — see `docs/DATA_MODEL.md`.
 */

export type CurrencyCode = "USD" | "GBP" | "EUR";

/** An amount of money. `minor` is always an integer and may be negative. */
export interface Money {
  readonly minor: number;
  readonly currency: CurrencyCode;
}

export class CurrencyMismatchError extends Error {
  constructor(left: CurrencyCode, right: CurrencyCode) {
    super(`Cannot combine ${left} with ${right}. Convert explicitly first.`);
    this.name = "CurrencyMismatchError";
  }
}

const MINOR_UNIT_EXPONENT: Record<CurrencyCode, number> = {
  USD: 2,
  GBP: 2,
  EUR: 2,
};

export function money(minor: number, currency: CurrencyCode = "USD"): Money {
  if (!Number.isInteger(minor)) {
    throw new TypeError(`Money must be an integer number of minor units, received ${minor}.`);
  }
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`Money value ${minor} exceeds the safe integer range.`);
  }
  return { minor, currency };
}

export const zero = (currency: CurrencyCode = "USD"): Money => money(0, currency);

/** Build a Money from a major-unit figure, e.g. `fromMajor(49)` -> $49.00. */
export function fromMajor(major: number, currency: CurrencyCode = "USD"): Money {
  const scale = 10 ** MINOR_UNIT_EXPONENT[currency];
  return money(Math.round(major * scale), currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function sum(amounts: readonly Money[], currency: CurrencyCode = "USD"): Money {
  return amounts.reduce<Money>((total, amount) => add(total, amount), zero(currency));
}

export function negate(amount: Money): Money {
  return money(-amount.minor, amount.currency);
}

export function isNegative(amount: Money): boolean {
  return amount.minor < 0;
}

export function isZero(amount: Money): boolean {
  return amount.minor === 0;
}

/**
 * Round half away from zero. Symmetric around zero so that a refund of a given
 * base reverses exactly the share that the original sale produced.
 */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Apply a rate (e.g. 0.3) to an amount, rounding half away from zero. */
export function applyRate(amount: Money, rate: number): Money {
  return money(roundHalfUp(amount.minor * rate), amount.currency);
}

/**
 * Format for display. Negative amounts are rendered with a leading minus rather
 * than parentheses so that a reversal is unmistakable in a dense table.
 */
export function formatMoney(
  amount: Money,
  options: { showCents?: boolean; locale?: string } = {},
): string {
  const { showCents = false, locale = "en-US" } = options;
  const exponent = MINOR_UNIT_EXPONENT[amount.currency];
  const major = amount.minor / 10 ** exponent;
  const hasFraction = amount.minor % 10 ** exponent !== 0;
  const fractionDigits = showCents || hasFraction ? exponent : 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: amount.currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(major);
}

/** Compact form for metric tiles, e.g. "$8,420". Never used for reconciliation. */
export function formatMoneyCompact(amount: Money, locale = "en-US"): string {
  return formatMoney(amount, { showCents: false, locale });
}

/** Render a range, e.g. "$900–$1,400". Uses an en dash, not a hyphen. */
export function formatMoneyRange(low: Money, high: Money, locale = "en-US"): string {
  assertSameCurrency(low, high);
  return `${formatMoney(low, { locale })}–${formatMoney(high, { locale })}`;
}
