import { describe, expect, it } from 'vitest';
import { budgetBar } from './progress';

describe('budgetBar', () => {
  it.each([
    [0, 10000, 'ok', 0, 10000],
    [9000, 10000, 'near', 90, 1000],
    [9999, 10000, 'near', 99, 1],
    [10000, 10000, 'near', 100, 0],
    [11000, 10000, 'over', 100, -1000],
    [-500, 10000, 'ok', 0, 10500],
  ] as const)(
    'spent %i of %i (%s) fills %i%% with %i left',
    (spentMinor, amountMinor, status, percent, remainingMinor) => {
      expect(budgetBar({ spentMinor, amountMinor, status })).toEqual({
        percent,
        status,
        remainingMinor,
      });
    },
  );
});
