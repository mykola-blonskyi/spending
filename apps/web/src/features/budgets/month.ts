import { todayIn } from '@shared/format';

/** A calendar month as `YYYY-MM`. */
export type Month = string;

export function currentMonth(timezone: string): Month {
  return todayIn(timezone).slice(0, 7);
}

export function shiftMonth(month: Month, delta: number): Month {
  const [year = 0, monthNumber = 1] = month.split('-').map(Number);
  const index = year * 12 + monthNumber - 1 + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}
