import { z } from 'zod';
import { addDays, daysBetween } from '../common/dates';
import { calendarDateSchema, ENTRY_KINDS, type EntryKind } from '../ledger/views';

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

/** Ten years of months is the longest period one request may span. */
export const MAX_PERIOD_DAYS = 3660;

export type Period = Readonly<{ from: string; to: string }>;

export const lengthInDays = (period: Period) => daysBetween(period.from, period.to) + 1;

/** Daily up to a month, weekly up to a quarter, monthly beyond. */
export function granularityOf(period: Period): Granularity {
  const days = lengthInDays(period);
  if (days <= 31) return 'day';
  if (days <= 92) return 'week';
  return 'month';
}

/** The equal-length period that ends the day before `period` starts. */
export function previousPeriod(period: Period): Period {
  return { from: addDays(period.from, -lengthInDays(period)), to: addDays(period.from, -1) };
}

/** The bucket a date falls in: the day, its ISO week's Monday or its month's first day, never before `from`. */
export function bucketOf(date: string, granularity: Granularity, from: string): string {
  const start =
    granularity === 'day'
      ? date
      : granularity === 'week'
        ? addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7))
        : `${date.slice(0, 7)}-01`;
  return start < from ? from : start;
}

/** Every bucket of the period in order, so charts get explicit zeros. */
export function bucketsOf(period: Period, granularity: Granularity): string[] {
  const buckets: string[] = [];
  for (let day = period.from; day <= period.to; day = addDays(day, 1)) {
    const bucket = bucketOf(day, granularity, period.from);
    if (buckets.at(-1) !== bucket) buckets.push(bucket);
  }
  return buckets;
}

const SHARE_SCALE = 10_000n;

/**
 * Each amount's share of the total with four decimals, rounded by largest remainder so the shares
 * add up to exactly 1. Ties go to the earlier amount.
 */
export function shares(amounts: readonly number[]): number[] {
  const total = amounts.reduce((sum, amount) => sum + BigInt(amount), 0n);
  if (total === 0n) return amounts.map(() => 0);
  const parts = amounts.map((amount, index) => {
    const scaled = BigInt(amount) * SHARE_SCALE;
    return { index, units: scaled / total, remainder: scaled % total };
  });
  let left = SHARE_SCALE - parts.reduce((sum, part) => sum + part.units, 0n);
  const byRemainder = [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const part of byRemainder) {
    if (left === 0n) break;
    part.units += 1n;
    left -= 1n;
  }
  return parts.map((part) => Number(part.units) / Number(SHARE_SCALE));
}

/** One group of confirmed, live transactions as the database sums it. */
export type SumRow = Readonly<{
  occurredOn: string;
  kind: EntryKind;
  categoryId: string | null;
  currency: string;
  convertedMinor: number;
  unconvertedMinor: number;
}>;

export type CategoryInfo = Readonly<{
  name: string;
  systemKey: string | null;
  color: string;
}>;

export type Totals = { incomeMinor: number; expenseMinor: number; balanceMinor: number };

export type CategoryShare = {
  categoryId: string | null;
  name: string | null;
  systemKey: string | null;
  kind: EntryKind;
  color: string | null;
  amountMinor: number;
  share: number;
};

const minorKey = { income: 'incomeMinor', expense: 'expenseMinor' } as const;

/** BR-15: totals count EUR amounts; rows without a conversion only reach `unconverted`. */
export function totalsOf(rows: readonly SumRow[]): Totals {
  const totals = { incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 };
  for (const row of rows) totals[minorKey[row.kind]] += row.convertedMinor;
  totals.balanceMinor = totals.incomeMinor - totals.expenseMinor;
  return totals;
}

export function unconvertedOf(rows: readonly SumRow[]) {
  const byCurrency = new Map<
    string,
    { currency: string; incomeMinor: number; expenseMinor: number }
  >();
  for (const row of rows) {
    if (row.unconvertedMinor === 0) continue;
    const entry = byCurrency.get(row.currency) ?? {
      currency: row.currency,
      incomeMinor: 0,
      expenseMinor: 0,
    };
    entry[minorKey[row.kind]] += row.unconvertedMinor;
    byCurrency.set(row.currency, entry);
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Expense categories first, then income, each by amount; shares are within the kind. */
export function byCategoryOf(
  rows: readonly SumRow[],
  categories: ReadonlyMap<string, CategoryInfo>,
): CategoryShare[] {
  return (['expense', 'income'] as const).flatMap((kind) => {
    const amounts = new Map<string | null, number>();
    for (const row of rows) {
      if (row.kind !== kind || row.convertedMinor === 0) continue;
      amounts.set(row.categoryId, (amounts.get(row.categoryId) ?? 0) + row.convertedMinor);
    }
    const sorted = [...amounts].sort((a, b) => b[1] - a[1]);
    const split = shares(sorted.map(([, amount]) => amount));
    return sorted.map(([categoryId, amountMinor], index) => {
      const info = categoryId ? categories.get(categoryId) : undefined;
      return {
        categoryId,
        name: info?.name ?? null,
        systemKey: info?.systemKey ?? null,
        kind,
        color: info?.color ?? null,
        amountMinor,
        share: split[index]!,
      };
    });
  });
}

export function seriesOf(rows: readonly SumRow[], period: Period, granularity: Granularity) {
  const series = new Map(
    bucketsOf(period, granularity).map((bucket) => [
      bucket,
      { bucket, incomeMinor: 0, expenseMinor: 0 },
    ]),
  );
  for (const row of rows) {
    series.get(bucketOf(row.occurredOn, granularity, period.from))![minorKey[row.kind]] +=
      row.convertedMinor;
  }
  return [...series.values()];
}

export const SCOPES = ['personal', 'family', 'all'] as const;

export const summaryQuerySchema = z
  .strictObject({
    from: calendarDateSchema,
    to: calendarDateSchema,
    scope: z.enum(SCOPES).default('all'),
    compare: z.enum(['previous', 'none']).default('previous'),
  })
  .refine((q) => q.to >= q.from, { message: 'must not be before from', path: ['to'] })
  .refine((q) => lengthInDays(q) <= MAX_PERIOD_DAYS, {
    message: `must be at most ${MAX_PERIOD_DAYS} days after from`,
    path: ['to'],
  });
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;

const periodSchema = z.object({ from: z.string(), to: z.string() });
const totalsSchema = z.object({
  incomeMinor: z.int(),
  expenseMinor: z.int(),
  balanceMinor: z.int(),
});
const categoryShareSchema = z.object({
  categoryId: z.uuid().nullable(),
  name: z.string().nullable(),
  systemKey: z.string().nullable(),
  kind: z.enum(ENTRY_KINDS),
  color: z.string().nullable(),
  amountMinor: z.int(),
  share: z.number(),
});

export const summarySchema = z.object({
  period: periodSchema,
  granularity: z.enum(GRANULARITIES),
  totals: totalsSchema,
  unconverted: z.array(
    z.object({ currency: z.string(), incomeMinor: z.int(), expenseMinor: z.int() }),
  ),
  byCategory: z.array(categoryShareSchema),
  series: z.array(z.object({ bucket: z.string(), incomeMinor: z.int(), expenseMinor: z.int() })),
  previous: z
    .object({
      period: periodSchema,
      totals: totalsSchema,
      byCategory: z.array(categoryShareSchema),
      /** Current minus previous. */
      deltas: totalsSchema,
    })
    .optional(),
});
export type Summary = z.infer<typeof summarySchema>;
