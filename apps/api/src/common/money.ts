declare const currencyBrand: unique symbol;
/** An ISO 4217 code the runtime's Intl data knows. Construct with `parseCurrency`. */
export type CurrencyCode = string & { readonly [currencyBrand]: true };

export const BASE_CURRENCY = 'EUR' as CurrencyCode;

const knownCurrencies = new Set(Intl.supportedValuesOf('currency'));

export function parseCurrency(code: string): CurrencyCode | null {
  return /^[A-Z]{3}$/.test(code) && knownCurrencies.has(code) ? (code as CurrencyCode) : null;
}

/**
 * ISO 4217 minor-unit digits where they differ from 2. Intl's digits are not ISO's (HUF, IDR and
 * COP format with 0), so they never decide the exponent. Keep in sync with
 * apps/web/src/shared/format/money.ts.
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

/** Number of minor-unit digits (EUR 2, JPY 0, KWD 3), per BR-13. */
export function currencyExponent(code: CurrencyCode): number {
  return MINOR_DIGITS[code] ?? 2;
}

type Decimal = { digits: bigint; scale: number };

function parseDecimal(text: string): Decimal | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return null;
  const fraction = match[2] ?? '';
  return { digits: BigInt(match[1]! + fraction), scale: fraction.length };
}

/** Division of non-negative integers rounding half to even, so conversions carry no bias. */
function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = remainder * 2n;
  if (twice > denominator || (twice === denominator && quotient % 2n !== 0n)) return quotient + 1n;
  return quotient;
}

/**
 * Converts an amount to EUR minor units with an ECB rate quoted as units of `currency` per 1 EUR.
 * Exact decimal arithmetic; no floating point touches the amount.
 */
export function convertToEurMinor(
  amountMinor: number,
  currency: CurrencyCode,
  ratePerEur: string,
): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new RangeError('Amount must be a positive safe integer');
  }
  const rate = parseDecimal(ratePerEur);
  if (!rate || rate.digits === 0n) throw new RangeError('Invalid exchange rate');
  const eurExponent = currencyExponent(BASE_CURRENCY);
  const exponent = currencyExponent(currency);
  const numerator = BigInt(amountMinor) * 10n ** BigInt(eurExponent + rate.scale);
  const denominator = rate.digits * 10n ** BigInt(exponent);
  const converted = divideHalfEven(numerator, denominator);
  if (converted > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('Converted amount overflows');
  return Number(converted);
}

/**
 * Renders minor units as a plain decimal string with "." (JPY 1234 → "1234", KWD 5 → "0.005",
 * EUR -150 → "-1.50"). String arithmetic only, so no amount ever passes through a float.
 */
export function formatMinor(amountMinor: number, exponent: number): string {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError('Amount must be a safe integer');
  const sign = amountMinor < 0 ? '-' : '';
  const digits = Math.abs(amountMinor).toString();
  if (exponent === 0) return sign + digits;
  const padded = digits.padStart(exponent + 1, '0');
  return `${sign}${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
}
