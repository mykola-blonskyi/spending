import { addDays, daysBetween, daysInMonth } from '../common/dates';

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export type Schedule = Readonly<{
  frequency: Frequency;
  interval: number;
  startsOn: string;
  endsOn: string | null;
}>;

const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const iso = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Months and years keep the day of `startsOn`, clamped to shorter months (BR-23). */
function occurrenceAt(schedule: Schedule, n: number): string {
  const { frequency, interval, startsOn } = schedule;
  const [year, month, day] = parts(startsOn);
  if (frequency === 'daily') return addDays(startsOn, n * interval);
  if (frequency === 'weekly') return addDays(startsOn, 7 * n * interval);
  const months = frequency === 'monthly' ? month - 1 + n * interval : month - 1 + 12 * n * interval;
  const y = year + Math.floor(months / 12);
  const m = (months % 12) + 1;
  return iso(y, m, Math.min(day, daysInMonth(y, m)));
}

/** An index whose occurrence is at most one step before `date`, so scans skip the distant past. */
function indexNear(schedule: Schedule, date: string): number {
  const { frequency, interval, startsOn } = schedule;
  const [y0, m0] = parts(startsOn);
  const [y1, m1] = parts(date);
  const steps = {
    daily: daysBetween(startsOn, date),
    weekly: daysBetween(startsOn, date) / 7,
    monthly: (y1 - y0) * 12 + (m1 - m0),
    yearly: y1 - y0,
  }[frequency];
  return Math.max(0, Math.floor(steps / interval) - 1);
}

/** Every occurrence in `[from, to]`, ending at `endsOn`. */
export function occurrences(schedule: Schedule, from: string, to: string): string[] {
  const last = schedule.endsOn !== null && schedule.endsOn < to ? schedule.endsOn : to;
  const dates: string[] = [];
  for (let n = indexNear(schedule, from); ; n++) {
    const date = occurrenceAt(schedule, n);
    if (date > last) return dates;
    if (date >= from) dates.push(date);
  }
}

/** The first occurrence on or after `date`, or null once the rule has ended. */
export function nextOccurrence(schedule: Schedule, date: string): string | null {
  for (let n = indexNear(schedule, date); ; n++) {
    const next = occurrenceAt(schedule, n);
    if (schedule.endsOn !== null && next > schedule.endsOn) return null;
    if (next >= date) return next;
  }
}
