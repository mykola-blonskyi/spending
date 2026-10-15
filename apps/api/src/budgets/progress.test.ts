import { describe, expect, it } from 'vitest';
import { budgetStatus, monthIn, monthRange, progress, putBudgetSchema } from './progress';

describe('monthIn', () => {
  it('uses the calendar month of the user, not of the server', () => {
    const instant = new Date('2026-10-31T23:30:00Z');
    expect(monthIn(instant, 'Europe/Madrid')).toBe('2026-11');
    expect(monthIn(instant, 'UTC')).toBe('2026-10');
    expect(monthIn(new Date('2027-01-01T02:00:00Z'), 'America/Los_Angeles')).toBe('2026-12');
  });
});

describe('monthRange', () => {
  it.each([
    ['2026-02', '2026-02-01', '2026-02-28'],
    ['2024-02', '2024-02-01', '2024-02-29'],
    ['2026-04', '2026-04-01', '2026-04-30'],
    ['2026-12', '2026-12-01', '2026-12-31'],
  ])('%s spans %s to %s', (month, from, to) => {
    expect(monthRange(month)).toEqual({ from, to });
  });

  it('rejects anything that is not a month', () => {
    expect(() => monthRange('2026-13')).toThrow(RangeError);
  });
});

describe('budgetStatus', () => {
  it.each([
    [0, 10_000, 'ok'],
    [7_999, 10_000, 'ok'],
    [8_000, 10_000, 'near'],
    [10_000, 10_000, 'near'],
    [10_001, 10_000, 'over'],
    [1, 1, 'near'],
    [2, 1, 'over'],
  ] as const)('%i of %i is %s', (spent, limit, status) => {
    expect(budgetStatus(spent, limit)).toBe(status);
  });
});

describe('progress', () => {
  it('sums converted amounts and lists unconverted ones per currency', () => {
    expect(
      progress(10_000, [
        { currency: 'USD', convertedMinor: 4_000, unconvertedMinor: 500 },
        { currency: 'EUR', convertedMinor: 4_500, unconvertedMinor: 0 },
        { currency: 'ARS', convertedMinor: 0, unconvertedMinor: 90_000 },
      ]),
    ).toEqual({
      spentMinor: 8_500,
      unconverted: [
        { currency: 'ARS', amountMinor: 90_000 },
        { currency: 'USD', amountMinor: 500 },
      ],
      status: 'near',
    });
  });

  it('is ok with nothing spent', () => {
    expect(progress(1, [])).toEqual({ spentMinor: 0, unconverted: [], status: 'ok' });
  });
});

describe('putBudgetSchema', () => {
  it('caps amountMinor at 1e12 (BR-13)', () => {
    const budget = {
      workspaceId: 'a0000000-0000-4000-8000-000000000001',
      categoryId: 'ca000000-0000-4000-8000-000000000005',
    };
    expect(putBudgetSchema.safeParse({ ...budget, amountMinor: 1_000_000_000_000 }).success).toBe(
      true,
    );
    expect(putBudgetSchema.safeParse({ ...budget, amountMinor: 1_000_000_000_001 }).success).toBe(
      false,
    );
  });
});
