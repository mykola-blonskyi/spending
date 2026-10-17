import type { components } from '@data/api.gen';

export type Summary = components['schemas']['SummaryDto_Output'];
export type CategoryShare = Summary['byCategory'][number];

export const PERIOD_KINDS = ['month', 'quarter', 'year', 'custom'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
/** Inclusive calendar dates (`YYYY-MM-DD`). */
export type Period = Readonly<{ kind: PeriodKind; from: string; to: string }>;

export const DASHBOARD_SCOPES = ['all', 'personal', 'family'] as const;
export type DashboardScope = (typeof DASHBOARD_SCOPES)[number];

/** The API refuses longer periods. */
const MAX_PERIOD_DAYS = 3660;

const MONTHS: Record<Exclude<PeriodKind, 'custom'>, number> = { month: 1, quarter: 3, year: 12 };
const DAY_MS = 86_400_000;

const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const addDays = (date: string, days: number) => iso(new Date(utc(date).getTime() + days * DAY_MS));
const lengthInDays = (period: Pick<Period, 'from' | 'to'>) =>
  (utc(period.to).getTime() - utc(period.from).getTime()) / DAY_MS + 1;

/** The calendar month, quarter or year that contains `date`. */
export function periodContaining(kind: Exclude<PeriodKind, 'custom'>, date: string): Period {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1;
  const first = month - (month % MONTHS[kind]);
  return {
    kind,
    from: iso(new Date(Date.UTC(year, first, 1))),
    to: iso(new Date(Date.UTC(year, first + MONTHS[kind], 0))),
  };
}

/** The next (`1`) or previous (`-1`) period of the same kind; a custom range moves by its length. */
export function shiftPeriod(period: Period, step: 1 | -1): Period {
  if (period.kind === 'custom') {
    const days = lengthInDays(period) * step;
    return { kind: 'custom', from: addDays(period.from, days), to: addDays(period.to, days) };
  }
  const start = utc(period.from);
  start.setUTCMonth(start.getUTCMonth() + MONTHS[period.kind] * step);
  return periodContaining(period.kind, iso(start));
}

export function periodProblem(period: Period): 'order' | 'length' | null {
  if (period.to < period.from) return 'order';
  return lengthInDays(period) > MAX_PERIOD_DAYS ? 'length' : null;
}

/** Against a previous period with nothing in it, every change is the whole total again: noise. */
export function withoutEmptyComparison(summary: Summary): Summary {
  const { previous, ...rest } = summary;
  if (!previous || previous.totals.incomeMinor !== 0 || previous.totals.expenseMinor !== 0)
    return summary;
  return rest;
}

/** A category only the previous period had has an amount and share of 0. */
export type CategoryComparison = CategoryShare & {
  key: string;
  /** `null` when the summary has no comparison. */
  previousMinor: number | null;
};

const keyOf = (row: CategoryShare) => `${row.kind}:${row.categoryId ?? ''}`;

/**
 * Every category of the period beside its amount in the previous one, then the categories only
 * the previous period had, at zero. Same-named personal and family categories stay apart (BR-15).
 */
export function compareCategories(summary: Summary): CategoryComparison[] {
  const previous = summary.previous;
  const before = new Map(previous?.byCategory.map((row) => [keyOf(row), row.amountMinor]));
  const current = summary.byCategory.map((row) => ({
    ...row,
    key: keyOf(row),
    previousMinor: previous ? (before.get(keyOf(row)) ?? 0) : null,
  }));
  const seen = new Set(current.map((row) => row.key));
  const gone = (previous?.byCategory ?? [])
    .filter((row) => !seen.has(keyOf(row)))
    .map((row) => ({
      ...row,
      key: keyOf(row),
      amountMinor: 0,
      share: 0,
      previousMinor: row.amountMinor,
    }));
  return (['expense', 'income'] as const).flatMap((kind) =>
    [...current, ...gone].filter((row) => row.kind === kind),
  );
}
