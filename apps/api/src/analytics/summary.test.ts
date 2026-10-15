import { describe, expect, it } from 'vitest';
import {
  bucketsOf,
  byCategoryOf,
  granularityOf,
  previousPeriod,
  seriesOf,
  shares,
  type SumRow,
  totalsOf,
  unconvertedOf,
} from './summary';

describe('granularityOf', () => {
  it.each([
    ['2026-10-01', '2026-10-31', 'day'],
    ['2026-10-01', '2026-11-01', 'week'],
    ['2026-07-01', '2026-09-30', 'week'],
    ['2026-07-01', '2026-10-01', 'month'],
    ['2026-01-01', '2026-12-31', 'month'],
  ] as const)('%s to %s is by %s', (from, to, granularity) => {
    expect(granularityOf({ from, to })).toBe(granularity);
  });
});

describe('previousPeriod', () => {
  it('is the equal-length period right before', () => {
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-31' })).toEqual({
      from: '2026-08-31',
      to: '2026-09-30',
    });
    expect(previousPeriod({ from: '2024-03-01', to: '2024-03-01' })).toEqual({
      from: '2024-02-29',
      to: '2024-02-29',
    });
  });
});

describe('bucketsOf', () => {
  it('starts weeks on Monday and months on the 1st, clipped to the period', () => {
    expect(bucketsOf({ from: '2026-10-01', to: '2026-10-20' }, 'week')).toEqual([
      '2026-10-01',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ]);
    expect(bucketsOf({ from: '2026-01-15', to: '2026-03-02' }, 'month')).toEqual([
      '2026-01-15',
      '2026-02-01',
      '2026-03-01',
    ]);
    expect(bucketsOf({ from: '2026-10-30', to: '2026-11-01' }, 'day')).toHaveLength(3);
  });
});

describe('shares', () => {
  it('rounds by largest remainder so the shares add up to 1', () => {
    expect(shares([1, 1, 1])).toEqual([0.3334, 0.3333, 0.3333]);
    expect(shares([2, 1, 1, 1, 1, 1])).toEqual([0.2857, 0.1429, 0.1429, 0.1429, 0.1428, 0.1428]);
    expect(shares([5, 0])).toEqual([1, 0]);
    expect(shares([])).toEqual([]);
    expect(shares([0, 0])).toEqual([0, 0]);
    const many = shares([7, 13, 29, 31, 101, 3, 977]);
    expect(Math.round(many.reduce((a, b) => a + b, 0) * 10_000)).toBe(10_000);
  });
});

const row = (overrides: Partial<SumRow>): SumRow => ({
  occurredOn: '2026-10-01',
  kind: 'expense',
  categoryId: 'food',
  currency: 'EUR',
  convertedMinor: 0,
  unconvertedMinor: 0,
  ...overrides,
});

describe('folding sums', () => {
  const rows = [
    row({ convertedMinor: 3_000 }),
    row({ currency: 'USD', convertedMinor: 1_000, occurredOn: '2026-10-09' }),
    row({ currency: 'ARS', unconvertedMinor: 50_000 }),
    row({ categoryId: null, convertedMinor: 4_000, occurredOn: '2026-10-20' }),
    row({ kind: 'income', categoryId: 'salary', convertedMinor: 10_000 }),
    row({ kind: 'income', categoryId: 'salary', currency: 'ARS', unconvertedMinor: 7 }),
  ];

  it('totals EUR amounts and lists unconverted ones per currency (BR-15)', () => {
    expect(totalsOf(rows)).toEqual({
      incomeMinor: 10_000,
      expenseMinor: 8_000,
      balanceMinor: 2_000,
    });
    expect(unconvertedOf(rows)).toEqual([
      { currency: 'ARS', incomeMinor: 7, expenseMinor: 50_000 },
    ]);
  });

  it('breaks down by category with shares per kind', () => {
    const info = new Map([
      ['food', { name: 'Groceries', systemKey: 'groceries', color: '#16a34a' }],
      ['salary', { name: 'Salary', systemKey: 'salary', color: '#15803d' }],
    ]);
    expect(byCategoryOf(rows, info)).toEqual([
      {
        categoryId: 'food',
        name: 'Groceries',
        systemKey: 'groceries',
        kind: 'expense',
        color: '#16a34a',
        amountMinor: 4_000,
        share: 0.5,
      },
      {
        categoryId: null,
        name: null,
        systemKey: null,
        kind: 'expense',
        color: null,
        amountMinor: 4_000,
        share: 0.5,
      },
      {
        categoryId: 'salary',
        name: 'Salary',
        systemKey: 'salary',
        kind: 'income',
        color: '#15803d',
        amountMinor: 10_000,
        share: 1,
      },
    ]);
  });

  it('fills every bucket of the series', () => {
    expect(seriesOf(rows, { from: '2026-10-01', to: '2026-11-15' }, 'week')).toEqual([
      { bucket: '2026-10-01', incomeMinor: 10_000, expenseMinor: 3_000 },
      { bucket: '2026-10-05', incomeMinor: 0, expenseMinor: 1_000 },
      { bucket: '2026-10-12', incomeMinor: 0, expenseMinor: 0 },
      { bucket: '2026-10-19', incomeMinor: 0, expenseMinor: 4_000 },
      { bucket: '2026-10-26', incomeMinor: 0, expenseMinor: 0 },
      { bucket: '2026-11-02', incomeMinor: 0, expenseMinor: 0 },
      { bucket: '2026-11-09', incomeMinor: 0, expenseMinor: 0 },
    ]);
  });
});
