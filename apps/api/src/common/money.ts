declare const currencyBrand: unique symbol;
/** An ISO 4217 code the runtime's Intl data knows. Construct with `parseCurrency`. */
export type CurrencyCode = string & { readonly [currencyBrand]: true };

export const BASE_CURRENCY = 'EUR' as CurrencyCode;

const knownCurrencies = new Set(Intl.supportedValuesOf('currency'));

export function parseCurrency(code: string): CurrencyCode | null {
  return /^[A-Z]{3}$/.test(code) && knownCurrencies.has(code) ? (code as CurrencyCode) : null;
}

/** Number of minor-unit digits (EUR 2, JPY 0, KWD 3), per BR-13. */
export function currencyExponent(code: CurrencyCode): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
    .maximumFractionDigits!;
}

type Decimal = { digits: bigint; scale: number };

function parseDecimal(text: string): Decimal | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return null;
  const fraction = match[2] ?? '';
  return { digits: BigInt(match[1]! + fraction), scale: fraction.length };
}

/** Integer division rounding half to even, so repeated conversions carry no bias. */
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
  const rate = parseDecimal(ratePerEur);
  if (!rate || rate.digits === 0n) throw new RangeError('Invalid exchange rate');
  const eurExponent = currencyExponent(BASE_CURRENCY);
  const exponent = currencyExponent(currency);
  const numerator = BigInt(amountMinor) * 10n ** BigInt(eurExponent + rate.scale);
  const denominator = rate.digits * 10n ** BigInt(exponent);
  return Number(divideHalfEven(numerator, denominator));
}

/**
 * Parses a human amount ("1.234,56", "-12.5", "1 234.5") into a signed minor-unit integer.
 * `decimalSeparator` disambiguates grouping. Returns null for anything that is not a plain amount
 * or that has more fraction digits than the currency allows.
 */
export function parseAmountToMinor(
  text: string,
  exponent: number,
  decimalSeparator: '.' | ',',
): number | null {
  const group = decimalSeparator === ',' ? /[.\s\u00a0\u202f']/g : /[,\s\u00a0\u202f']/g;
  let normalized = text.trim().replace(group, '');
  if (decimalSeparator === ',') normalized = normalized.replace(',', '.');
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(normalized);
  if (!match) return null;
  const fraction = match[3] ?? '';
  if (fraction.length > exponent) return null;
  const minor = BigInt(match[2]! + fraction.padEnd(exponent, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(match[1] === '-' ? -minor : minor);
}
