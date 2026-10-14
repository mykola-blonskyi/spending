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
 * Parses a human amount ("1.234,56", "-12.5", "1 234.5") into a signed minor-unit integer.
 * Grouping characters are accepted only between valid groups of three digits, so a wrong
 * separator choice fails loudly ("12,50" with "." as decimal separator) instead of scaling the
 * amount. Returns null for anything that is not a plain amount or has too many fraction digits.
 */
export function parseAmountToMinor(
  text: string,
  exponent: number,
  decimalSeparator: '.' | ',',
): number | null {
  const groupChars = decimalSeparator === ',' ? ". \\u00a0\\u202f'" : ", \\u00a0\\u202f'";
  const match = new RegExp(
    `^([+-]?)(\\d{1,3}(?:([${groupChars}])\\d{3}(?:\\3\\d{3})*)?|\\d+)(?:\\${decimalSeparator}(\\d+))?$`,
  ).exec(text.trim());
  if (!match) return null;
  const integer = match[2]!.replace(/\D/g, '');
  const fraction = match[4] ?? '';
  if (fraction.length > exponent) return null;
  const minor = BigInt(integer + fraction.padEnd(exponent, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(match[1] === '-' ? -minor : minor);
}
