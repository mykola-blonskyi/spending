const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real `YYYY-MM-DD` calendar date (no 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Shifts a `YYYY-MM-DD` date by whole days in UTC, so no time zone can move it. */
export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
