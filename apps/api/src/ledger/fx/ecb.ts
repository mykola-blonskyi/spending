import { isCalendarDate } from '../../common/dates';
import { parseCurrency } from '../../common/money';

export type FxRate = Readonly<{ date: string; currency: string; ratePerEur: string }>;

/** Fits `numeric(20, 10)` and is strictly positive. */
const RATE = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,10})?$/;
/**
 * The closing `>` is optional so the pattern always matches without backtracking: one pass over
 * the input, even for the ~30 MB full history. A tag without it is rejected below.
 */
const CUBE = /<Cube\b([^>]*)(>)?/g;
const ATTRIBUTE = /(?<!\w)(\w+)\s*=\s*(?:'([^']*)'|"([^"]*)")/g;
/** Real Cube tags are short; a longer one is corruption, and parsing it is not worth the time. */
const MAX_TAG_LENGTH = 200;

function attributes(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of text.matchAll(ATTRIBUTE)) result.set(match[1]!, match[2] ?? match[3]!);
  return result;
}

/**
 * Reads the ECB reference-rate XML (`<Cube time=…>` days holding `<Cube currency=… rate=…>`).
 * Throws on anything it cannot trust, so a corrupted feed never reaches `fx_rates`. Currencies
 * the runtime does not know are skipped, since no transaction can use them.
 */
export function parseEcbXml(xml: string): FxRate[] {
  const rates: FxRate[] = [];
  let day: string | null = null;
  for (const match of xml.matchAll(CUBE)) {
    if (match[2] === undefined) throw new Error('ECB feed has an unterminated tag');
    if (match[1]!.length > MAX_TAG_LENGTH) throw new Error('ECB feed has an oversized tag');
    const attrs = attributes(match[1]!);
    const time = attrs.get('time');
    if (time !== undefined) {
      if (!isCalendarDate(time)) throw new Error('ECB feed has an invalid date');
      day = time;
      continue;
    }
    const currency = attrs.get('currency');
    const rate = attrs.get('rate');
    if (currency === undefined && rate === undefined) continue;
    if (!day || !currency || !rate) throw new Error('ECB feed has a rate outside a day');
    if (!RATE.test(rate) || !/[1-9]/.test(rate)) throw new Error('ECB feed has an invalid rate');
    if (parseCurrency(currency)) rates.push({ date: day, currency, ratePerEur: rate });
  }
  if (rates.length === 0) throw new Error('ECB feed has no rates');
  // A body cut cleanly between tags would otherwise pass as a shorter, valid feed.
  if (!xml.trimEnd().endsWith('</gesmes:Envelope>')) throw new Error('ECB feed is truncated');
  return rates;
}
