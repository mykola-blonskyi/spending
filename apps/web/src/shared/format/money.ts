import { numberFormat } from './number';

export type MoneyFormatOptions = {
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'negative' | 'never';
};

/**
 * ISO 4217 minor-unit digits where they differ from 2. Intl's digits are not ISO's (HUF, IDR and
 * COP format with 0), so they never decide the exponent. Keep in sync with
 * apps/api/src/common/money.ts.
 */
const MINOR_DIGITS: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

/** Offered in every currency picker, next to the currencies of the user's accounts. */
export const COMMON_CURRENCIES: readonly string[] = ['EUR', 'USD', 'GBP', 'UAH', 'PLN'];

/** The ISO 4217 minor-unit exponent (EUR 2, JPY 0, KWD 3). */
export function currencyExponent(currency: string): number {
  return MINOR_DIGITS[currency] ?? 2;
}

/**
 * Builds the exact decimal string for an integer amount of minor units, so that no
 * floating-point division touches the value before Intl formats it.
 */
export function minorToDecimalString(minorUnits: number | bigint, exponent: number): string {
  if (typeof minorUnits === 'number' && !Number.isSafeInteger(minorUnits)) {
    throw new RangeError(`Minor units must be a safe integer, got ${minorUnits}`);
  }
  const value = BigInt(minorUnits);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  if (exponent === 0) return (negative ? '-' : '') + digits;
  const padded = digits.padStart(exponent + 1, '0');
  const whole = padded.slice(0, -exponent);
  const fraction = padded.slice(-exponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function formatMoney(
  minorUnits: number | bigint,
  currency: string,
  locale: string,
  options: MoneyFormatOptions = {},
): string {
  const exponent = currencyExponent(currency);
  const format = numberFormat(locale, {
    style: 'currency',
    currency,
    signDisplay: options.signDisplay ?? 'auto',
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });
  return format.format(minorToDecimalString(minorUnits, exponent) as Intl.StringNumericLiteral);
}

const AMOUNT = /^(\d+)(?:[.,](\d*))?$/;

/** BR-13: the largest amount the server accepts, in minor units. */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;
/** The server's entry text limits. */
export const DESCRIPTION_MAX = 200;
export const NOTE_MAX = 2000;

/** Parses what the user typed ("12", "12.5", "12,50") into positive minor units, or null. */
export function parseAmount(text: string, exponent: number): number | null {
  const match = AMOUNT.exec(text.trim().replace(/\s/g, ''));
  if (!match) return null;
  const [, whole = '', fraction = ''] = match;
  if (fraction.length > exponent) return null;
  const minor = Number(whole + fraction.padEnd(exponent, '0'));
  return minor > 0 && minor <= MAX_AMOUNT_MINOR ? minor : null;
}

/** The decimal mark this locale writes, for the keypad label and the shown amount. */
export function decimalSeparator(locale: string): string {
  return (
    new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === 'decimal')
      ?.value ?? '.'
  );
}
