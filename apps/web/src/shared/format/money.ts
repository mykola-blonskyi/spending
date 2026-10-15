import { numberFormat } from './number';

export type MoneyFormatOptions = {
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'negative' | 'never';
};

/** The ISO 4217 minor-unit exponent (EUR 2, JPY 0, KWD 3), as Intl reports it. */
export function currencyExponent(currency: string): number {
  return numberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits as number;
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

/** Parses what the user typed ("12", "12.5", "12,50") into positive minor units, or null. */
export function parseAmount(text: string, exponent: number): number | null {
  const match = AMOUNT.exec(text.trim().replace(/\s/g, ''));
  if (!match) return null;
  const [, whole = '', fraction = ''] = match;
  if (fraction.length > exponent) return null;
  const minor = Number(whole + fraction.padEnd(exponent, '0'));
  return minor > 0 && minor <= MAX_AMOUNT_MINOR ? minor : null;
}
