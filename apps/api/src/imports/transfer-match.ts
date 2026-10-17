import { addDays, daysBetween } from '../common/dates';
import type { CurrencyCode } from '../common/money';
import { convert, type RateQuote } from '../ledger/fx/conversion';
import type { EntryKind } from '../ledger/views';
import { words } from './categorize';

/**
 * BR-38: phrases that say "between my own accounts", per language. Each matches as whole folded
 * words of the description, so "на свій рахунок" also finds "НА СВІЙ РАХУНОК 4149".
 */
const TRANSFER_KEYWORDS: Readonly<Record<'uk' | 'ru' | 'en' | 'es', readonly string[]>> = {
  uk: ['на свій рахунок', 'зі своєї картки', 'на свою картку'],
  ru: ['на свой счет', 'со своей карты', 'на свою карту'],
  en: ['own account', 'transfer to own'],
  es: ['traspaso', 'entre cuentas'],
};
const FOLDED_KEYWORDS = Object.values(TRANSFER_KEYWORDS)
  .flat()
  .map((keyword) => words(keyword).join(' '));

export const TRANSFER_WINDOW_DAYS = 3;
/** Across currencies the sides may differ by this share of the imported side (fees, spreads). */
const CROSS_CURRENCY_TOLERANCE_PERCENT = 3;

export type MatchRow = Readonly<{
  id: string;
  kind: EntryKind;
  amountMinor: number;
  currency: CurrencyCode;
  occurredOn: string;
  accountId: string | null;
  description: string;
}>;

export type TransferSuggestion = Readonly<{
  transactionId: string;
  /** Null: a transfer to or from an own account outside the app. */
  counterpartId: string | null;
  reason: 'keyword' | 'counterpart';
}>;

export type RateLookup = (currency: CurrencyCode, date: string) => RateQuote | null;

/** How far apart two sides are in EUR minor units, or null when they cannot be one transfer. */
function amountGap(row: MatchRow, other: MatchRow, rate: RateLookup): number | null {
  if (row.currency === other.currency) return row.amountMinor === other.amountMinor ? 0 : null;
  const eur = (side: MatchRow) =>
    convert(side.amountMinor, side.currency, rate(side.currency, row.occurredOn)).baseAmountMinor;
  const [mine, theirs] = [eur(row), eur(other)];
  if (mine === null || theirs === null) return null;
  const gap = Math.abs(mine - theirs);
  return gap * 100 <= CROSS_CURRENCY_TOLERANCE_PERCENT * mine ? gap : null;
}

function looksOwn(description: string, name: readonly string[]): boolean {
  const tokens = words(description);
  const padded = ` ${tokens.join(' ')} `;
  return (
    FOLDED_KEYWORDS.some((keyword) => padded.includes(` ${keyword} `)) ||
    (name.length >= 2 && name.every((token) => tokens.includes(token)))
  );
}

/**
 * BR-38. Each imported row paired with an entry of the opposite kind on another account within
 * three days (equal amount, or within 3% in EUR at the rate of the imported row's date), each
 * candidate used once, nearest date then nearest amount first. A row left unpaired whose
 * description has a transfer phrase or every word of the user's name is a one-sided suggestion.
 */
export function suggestTransfers(
  imported: readonly MatchRow[],
  candidates: readonly MatchRow[],
  ownName: string,
  rate: RateLookup,
): TransferSuggestion[] {
  const byDate = new Map<string, MatchRow[]>();
  for (const candidate of candidates) {
    const day = byDate.get(candidate.occurredOn);
    if (day) day.push(candidate);
    else byDate.set(candidate.occurredOn, [candidate]);
  }
  const pairs = imported.flatMap((row) => {
    const nearby = [];
    for (let day = -TRANSFER_WINDOW_DAYS; day <= TRANSFER_WINDOW_DAYS; day++) {
      nearby.push(...(byDate.get(addDays(row.occurredOn, day)) ?? []));
    }
    return nearby.flatMap((other) => {
      if (other.kind === row.kind || other.accountId === row.accountId) return [];
      const gap = amountGap(row, other, rate);
      if (gap === null) return [];
      return [{ row, other, gap, days: Math.abs(daysBetween(row.occurredOn, other.occurredOn)) }];
    });
  });
  pairs.sort((a, b) => a.days - b.days || a.gap - b.gap);
  const counterparts = new Map<string, string>();
  const used = new Set<string>();
  for (const { row, other } of pairs) {
    if (counterparts.has(row.id) || used.has(other.id)) continue;
    counterparts.set(row.id, other.id);
    used.add(other.id);
  }
  const name = words(ownName);
  return imported.flatMap((row): TransferSuggestion[] => {
    const counterpartId = counterparts.get(row.id);
    if (counterpartId) return [{ transactionId: row.id, counterpartId, reason: 'counterpart' }];
    return looksOwn(row.description, name)
      ? [{ transactionId: row.id, counterpartId: null, reason: 'keyword' }]
      : [];
  });
}
