import { describe, expect, it } from 'vitest';
import {
  type CategoryShare,
  compareCategories,
  periodContaining,
  periodProblem,
  shiftPeriod,
  type Summary,
} from './dashboard-model';

describe('periodContaining', () => {
  it('finds the calendar month, quarter and year of a date', () => {
    expect(periodContaining('month', '2028-02-14')).toEqual({
      kind: 'month',
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(periodContaining('quarter', '2026-11-30')).toEqual({
      kind: 'quarter',
      from: '2026-10-01',
      to: '2026-12-31',
    });
    expect(periodContaining('quarter', '2026-01-01')).toMatchObject({
      from: '2026-01-01',
      to: '2026-03-31',
    });
    expect(periodContaining('year', '2026-07-04')).toEqual({
      kind: 'year',
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });
});

describe('shiftPeriod', () => {
  it('steps whole months, quarters and years across year ends', () => {
    expect(shiftPeriod(periodContaining('month', '2026-01-10'), -1)).toEqual({
      kind: 'month',
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(shiftPeriod(periodContaining('month', '2026-01-31'), 1)).toMatchObject({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(shiftPeriod(periodContaining('quarter', '2026-11-01'), 1)).toMatchObject({
      from: '2027-01-01',
      to: '2027-03-31',
    });
    expect(shiftPeriod(periodContaining('year', '2026-05-01'), -1)).toMatchObject({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('moves a custom range by its own length', () => {
    expect(shiftPeriod({ kind: 'custom', from: '2026-03-25', to: '2026-04-03' }, -1)).toEqual({
      kind: 'custom',
      from: '2026-03-15',
      to: '2026-03-24',
    });
  });
});

describe('periodProblem', () => {
  it('rejects a reversed range and one longer than the API allows', () => {
    expect(periodProblem({ kind: 'custom', from: '2026-10-02', to: '2026-10-01' })).toBe('order');
    expect(periodProblem({ kind: 'custom', from: '2016-01-01', to: '2026-01-08' })).toBe('length');
    expect(periodProblem({ kind: 'custom', from: '2016-01-01', to: '2026-01-07' })).toBeNull();
    expect(periodProblem({ kind: 'custom', from: '2026-10-01', to: '2026-10-01' })).toBeNull();
  });
});

const share = (patch: Partial<CategoryShare>): CategoryShare => ({
  categoryId: 'groceries',
  name: null,
  systemKey: 'groceries',
  kind: 'expense',
  color: '#16a34a',
  amountMinor: 0,
  share: 0,
  ...patch,
});

const summary = (byCategory: CategoryShare[], previous?: CategoryShare[]): Summary => ({
  period: { from: '2026-10-01', to: '2026-10-31' },
  granularity: 'day',
  totals: { incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
  unconverted: [],
  byCategory,
  series: [],
  previous: previous && {
    period: { from: '2026-09-01', to: '2026-09-30' },
    totals: { incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
    byCategory: previous,
    deltas: { incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
  },
});

describe('compareCategories', () => {
  it('pairs each category with its previous amount, keeping kinds and scopes apart', () => {
    const rows = compareCategories(
      summary(
        [
          share({ amountMinor: 7_000, share: 0.7 }),
          share({ categoryId: 'family-groceries', amountMinor: 3_000, share: 0.3 }),
          share({ categoryId: 'salary', kind: 'income', amountMinor: 300_000, share: 1 }),
        ],
        [
          share({ amountMinor: 3_000, share: 0.6 }),
          share({ categoryId: null, name: null, amountMinor: 2_000, share: 0.4 }),
          share({ categoryId: 'salary', kind: 'income', amountMinor: 250_000, share: 1 }),
        ],
      ),
    );
    expect(rows.map((row) => [row.key, row.amountMinor, row.previousMinor, row.share])).toEqual([
      ['expense:groceries', 7_000, 3_000, 0.7],
      ['expense:family-groceries', 3_000, 0, 0.3],
      ['expense:', 0, 2_000, 0],
      ['income:salary', 300_000, 250_000, 1],
    ]);
  });

  it('has no previous amounts without a comparison', () => {
    const rows = compareCategories(summary([share({ amountMinor: 500, share: 1 })]));
    expect(rows).toEqual([expect.objectContaining({ amountMinor: 500, previousMinor: null })]);
  });
});
