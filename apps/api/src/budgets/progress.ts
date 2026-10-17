import { z } from 'zod';
import { daysInMonth, todayIn } from '../common/dates';
import { WORKSPACE_KINDS } from '../workspaces/family';
import { amountMinorSchema } from '../ledger/views';

const BUDGET_STATUSES = ['ok', 'near', 'over'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

/** Spending at or above this share of the limit is `near`. */
const NEAR_LIMIT_PERCENT = 80;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The `YYYY-MM` month `now` falls in for someone living in `timezone` (BR-22). */
export function monthIn(now: Date, timezone: string): string {
  return todayIn(now, timezone).slice(0, 7);
}

/** First and last calendar date of a `YYYY-MM` month, both inclusive. */
export function monthRange(month: string): { from: string; to: string } {
  const match = MONTH.exec(month);
  if (!match) throw new RangeError(`Invalid month ${month}`);
  const last = daysInMonth(Number(match[1]), Number(match[2]));
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Integer comparison, so no rounding decides the threshold. Spending the exact limit is not over. */
export function budgetStatus(spentMinor: number, limitMinor: number): BudgetStatus {
  if (spentMinor > limitMinor) return 'over';
  if (spentMinor * 100 >= limitMinor * NEAR_LIMIT_PERCENT) return 'near';
  return 'ok';
}

const monthSchema = z
  .string()
  .regex(MONTH, 'must be a YYYY-MM month')
  .refine((value) => value >= '1970-01' && value <= '2100-12', 'out of range');

export const budgetQuerySchema = z.strictObject({
  workspaceId: z.uuid().optional(),
  month: monthSchema.optional(),
});
export type BudgetQuery = z.infer<typeof budgetQuerySchema>;

export const putBudgetSchema = z.strictObject({
  workspaceId: z.uuid(),
  categoryId: z.uuid(),
  amountMinor: amountMinorSchema,
});
export type PutBudget = z.infer<typeof putBudgetSchema>;

const unconvertedSchema = z.object({ currency: z.string(), amountMinor: z.int() });

export const budgetViewSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  scope: z.enum(WORKSPACE_KINDS),
  categoryId: z.uuid(),
  amountMinor: z.int(),
  month: z.string(),
  spentMinor: z.int(),
  unconverted: z.array(unconvertedSchema),
  status: z.enum(BUDGET_STATUSES),
});
export type BudgetView = z.infer<typeof budgetViewSchema>;

export const budgetListSchema = z.object({ budgets: z.array(budgetViewSchema) });

/** One currency's expenses in a budget's category and month, as summed by the database. */
export type CurrencySum = Readonly<{
  currency: string;
  convertedMinor: number;
  unconvertedMinor: number;
}>;

export type Progress = Pick<BudgetView, 'spentMinor' | 'unconverted' | 'status'>;

/** BR-15/BR-22: progress counts EUR amounts only; unconverted ones are listed per currency. */
export function progress(limitMinor: number, sums: readonly CurrencySum[]): Progress {
  const spentMinor = sums.reduce((total, sum) => total + sum.convertedMinor, 0);
  const unconverted = sums
    .filter((sum) => sum.unconvertedMinor > 0)
    .map((sum) => ({ currency: sum.currency, amountMinor: sum.unconvertedMinor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  return { spentMinor, unconverted, status: budgetStatus(spentMinor, limitMinor) };
}
