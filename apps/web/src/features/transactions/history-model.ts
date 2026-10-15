import type { Account, EntrySync, Fx, TransactionEntry, TransactionFilter } from '@data/sync';
import type { CategoryView } from '@features/ledger';
import { formatDate, formatRate } from '@shared/format';
import type { EntryKind } from './form-model';

export type HistoryKind = 'all' | EntryKind;

/** What the user filters by. `''` means any. */
export type HistoryFilters = Readonly<{
  text: string;
  kind: HistoryKind;
  from: string;
  to: string;
  categoryId: string;
  accountId: string;
  currency: string;
}>;

export const EMPTY_FILTERS: HistoryFilters = {
  text: '',
  kind: 'all',
  from: '',
  to: '',
  categoryId: '',
  accountId: '',
  currency: '',
};

const EXACT_KEYS = ['from', 'to', 'categoryId', 'accountId', 'currency'] as const;

export function toQuery(filters: HistoryFilters): TransactionFilter {
  const query: { -readonly [K in keyof TransactionFilter]: TransactionFilter[K] } = {};
  if (filters.text.trim()) query.text = filters.text;
  if (filters.kind !== 'all') query.kind = filters.kind;
  for (const key of EXACT_KEYS) if (filters[key]) query[key] = filters[key];
  return query;
}

/** A filter shown as a removable chip; search text and type have their own controls. */
export type ActiveFilter = 'period' | 'categoryId' | 'accountId' | 'currency';

export function activeFilters(filters: HistoryFilters): ActiveFilter[] {
  const active: ActiveFilter[] = [];
  if (filters.from || filters.to) active.push('period');
  if (filters.categoryId) active.push('categoryId');
  if (filters.accountId) active.push('accountId');
  if (filters.currency) active.push('currency');
  return active;
}

export function clearFilter(filters: HistoryFilters, filter: ActiveFilter): HistoryFilters {
  return filter === 'period' ? { ...filters, from: '', to: '' } : { ...filters, [filter]: '' };
}

/** How an entry relates to EUR, the base currency (BR-14). */
export type Conversion =
  | Readonly<{ state: 'same' }>
  | Readonly<{ state: 'converted'; baseAmountMinor: number; fx: Fx }>
  | Readonly<{ state: 'unavailable' }>;

export function conversionOf(
  entry: Pick<TransactionEntry, 'currency' | 'baseAmountMinor' | 'fx'>,
): Conversion {
  if (entry.currency === 'EUR') return { state: 'same' };
  if (entry.baseAmountMinor === null || !entry.fx) return { state: 'unavailable' };
  return { state: 'converted', baseAmountMinor: entry.baseAmountMinor, fx: entry.fx };
}

/** Rate, rate date and source as people read them: "1.0850", "Oct 14, 2026", "ECB". */
export function fxLabels(fx: Fx, locale: string) {
  return {
    rate: formatRate(fx.rate, locale),
    date: formatDate(fx.rateDate, locale),
    source: fx.source.toUpperCase(),
  };
}

export type EntryRow = Readonly<{
  id: string;
  href: string;
  /** The description, else the category name, else "Uncategorized". */
  title: string;
  /** Category and account, without repeating a category the title already shows. */
  subtitle: string;
  category: CategoryView | undefined;
  accountName: string | undefined;
  occurredOn: string;
  dateLabel: string;
  kind: EntryKind;
  /** The original amount and currency, as entered. */
  amountMinor: number;
  currency: string;
  conversion: Conversion;
  sync: EntrySync;
}>;

export type RowContext = Readonly<{
  categories: ReadonlyMap<string, CategoryView>;
  accounts: ReadonlyMap<string, Account>;
  dayLabel: (date: string) => string;
  uncategorized: string;
}>;

export function toEntryRow(entry: TransactionEntry, context: RowContext): EntryRow {
  const category = entry.categoryId ? context.categories.get(entry.categoryId) : undefined;
  const accountName = entry.accountId ? context.accounts.get(entry.accountId)?.name : undefined;
  const title = entry.description || category?.name || context.uncategorized;
  return {
    id: entry.id,
    href: `/transactions/${entry.id}`,
    title,
    subtitle: [category?.name === title ? undefined : category?.name, accountName]
      .filter(Boolean)
      .join(' · '),
    category,
    accountName,
    occurredOn: entry.occurredOn,
    dateLabel: context.dayLabel(entry.occurredOn),
    kind: entry.kind,
    amountMinor: entry.amountMinor,
    currency: entry.currency,
    conversion: conversionOf(entry),
    sync: entry.sync,
  };
}

type Sums = { expense: number; income: number };

/**
 * Spent and received in EUR, plus what has no EUR amount yet per currency, ordered by currency.
 * Never mixed (BR-15).
 */
export type Totals = Readonly<{
  base: Readonly<Sums>;
  unconverted: readonly Readonly<Sums & { currency: string }>[];
}>;

export function summarize(
  entries: readonly Pick<EntryRow, 'kind' | 'amountMinor' | 'currency' | 'conversion'>[],
): Totals {
  const base = { expense: 0, income: 0 };
  const unconverted = new Map<string, Sums & { currency: string }>();
  for (const entry of entries) {
    const { conversion } = entry;
    if (conversion.state === 'unavailable') {
      const sum = unconverted.get(entry.currency) ?? {
        currency: entry.currency,
        expense: 0,
        income: 0,
      };
      sum[entry.kind] += entry.amountMinor;
      unconverted.set(entry.currency, sum);
    } else {
      base[entry.kind] +=
        conversion.state === 'converted' ? conversion.baseAmountMinor : entry.amountMinor;
    }
  }
  return {
    base,
    unconverted: [...unconverted.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

/** A day's net per currency: EUR when the day has any EUR amount, then each unconverted currency. */
export function dayNets(totals: Totals): { currency: string; net: number }[] {
  const { base, unconverted } = totals;
  const nets = unconverted.map((sum) => ({
    currency: sum.currency,
    net: sum.income - sum.expense,
  }));
  return base.expense + base.income > 0
    ? [{ currency: 'EUR', net: base.income - base.expense }, ...nets]
    : nets;
}

export type DayItem = Readonly<{
  type: 'day';
  key: string;
  date: string;
  label: string;
  count: number;
  totals: Totals;
}>;

/** Where a row sits in its day, so card layouts can draw one bordered card per day. */
export type RowPosition = 'first' | 'middle' | 'last' | 'only';

export type EntryItem = Readonly<{
  type: 'entry';
  key: string;
  row: EntryRow;
  position: RowPosition;
}>;

export type HistoryItem = DayItem | EntryItem;

function positionOf(index: number, count: number): RowPosition {
  if (count === 1) return 'only';
  if (index === 0) return 'first';
  return index === count - 1 ? 'last' : 'middle';
}

/** Flattens rows (newest first) into day headers followed by that day's rows. */
export function groupByDay(
  rows: readonly EntryRow[],
  dayLabel: (date: string) => string,
): HistoryItem[] {
  const items: HistoryItem[] = [];
  let start = 0;
  while (start < rows.length) {
    const date = rows[start]!.occurredOn;
    let end = start + 1;
    while (end < rows.length && rows[end]!.occurredOn === date) end++;
    const day = rows.slice(start, end);
    items.push({
      type: 'day',
      key: `day-${date}`,
      date,
      label: dayLabel(date),
      count: day.length,
      totals: summarize(day),
    });
    day.forEach((row, index) =>
      items.push({ type: 'entry', key: row.id, row, position: positionOf(index, day.length) }),
    );
    start = end;
  }
  return items;
}
