import { addDays } from '../../common/dates';
import { BASE_CURRENCY, convertToEurMinor, type CurrencyCode } from '../../common/money';

/** BR-14: the rate of the day, or of the latest earlier published day within 7 days. */
export const RATE_LOOKBACK_DAYS = 7;

export function rateWindow(occurredOn: string): { from: string; to: string } {
  return { from: addDays(occurredOn, -RATE_LOOKBACK_DAYS), to: occurredOn };
}

export type Conversion = Readonly<{
  baseAmountMinor: number | null;
  fxRate: string | null;
  fxRateDate: string | null;
  fxSource: string | null;
}>;

export type RateQuote = Readonly<{ date: string; ratePerEur: string; source: string }>;

export const UNCONVERTED: Conversion = {
  baseAmountMinor: null,
  fxRate: null,
  fxRateDate: null,
  fxSource: null,
};

/**
 * EUR converts to itself with no rate. Anything else needs a quote, and stays unconverted
 * without one or when the EUR amount would not fit a safe integer.
 */
export function convert(
  amountMinor: number,
  currency: CurrencyCode,
  quote: RateQuote | null,
): Conversion {
  if (currency === BASE_CURRENCY) return { ...UNCONVERTED, baseAmountMinor: amountMinor };
  if (!quote) return UNCONVERTED;
  let baseAmountMinor: number;
  try {
    baseAmountMinor = convertToEurMinor(amountMinor, currency, quote.ratePerEur);
  } catch {
    return UNCONVERTED;
  }
  return {
    baseAmountMinor,
    fxRate: quote.ratePerEur,
    fxRateDate: quote.date,
    fxSource: quote.source,
  };
}
