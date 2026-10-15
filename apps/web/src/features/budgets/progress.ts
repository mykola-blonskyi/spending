import type { Budget } from './budgets';

export type BudgetBar = {
  /** Whole percent of the limit spent, clamped to 0..100 for the bar. */
  percent: number;
  status: Budget['status'];
  /** Negative when over the limit. */
  remainingMinor: number;
};

export function budgetBar({
  amountMinor,
  spentMinor,
  status,
}: Pick<Budget, 'amountMinor' | 'spentMinor' | 'status'>): BudgetBar {
  // Floor, so the bar reads full only once the limit is actually reached.
  const percent = Math.min(100, Math.max(0, Math.floor((spentMinor * 100) / amountMinor)));
  return { percent, status, remainingMinor: amountMinor - spentMinor };
}
