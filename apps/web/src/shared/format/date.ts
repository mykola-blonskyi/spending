const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_ONLY = /^(\d{4})-(\d{2})$/;
const DAY_MS = 86_400_000;

export type DateInput = string | Date;

/**
 * `YYYY-MM-DD` is a calendar date, not an instant. `new Date('2026-10-14')` parses it as UTC
 * midnight, which shows as the previous day west of Greenwich, so it is built from local parts.
 */
export function parseDateOnly(value: string): Date {
  const match = DATE_ONLY.exec(value);
  if (!match) throw new RangeError(`Expected YYYY-MM-DD, got "${value}"`);
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function toDate(value: DateInput): Date {
  if (value instanceof Date) return value;
  if (DATE_ONLY.test(value)) return parseDateOnly(value);
  const month = MONTH_ONLY.exec(value);
  if (month) return new Date(Number(month[1]), Number(month[2]) - 1, 1);
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new RangeError(`Invalid date "${value}"`);
  return instant;
}

function capitalize(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

const cache = new Map<string, Intl.DateTimeFormat>();

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = cache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    cache.set(key, format);
  }
  return format;
}

export function formatDate(
  value: DateInput,
  locale: string,
  options: { dateStyle?: 'short' | 'medium' | 'long' | 'full'; timeStyle?: 'short' } = {},
): string {
  return dateFormat(locale, { dateStyle: options.dateStyle ?? 'medium', ...options }).format(
    toDate(value),
  );
}

/** A standalone month label such as "October 2026", capitalized for use as a heading. */
export function formatMonth(value: DateInput, locale: string): string {
  return capitalize(
    dateFormat(locale, { month: 'long', year: 'numeric' }).format(toDate(value)),
    locale,
  );
}

function calendarDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

/**
 * "Today", "Yesterday", "Tomorrow", otherwise a medium date. Capitalized for use as a label.
 * `today` is a `YYYY-MM-DD` from `todayIn` with the user's time zone, not the device's.
 */
export function formatRelativeDay(value: DateInput, locale: string, today: string) {
  const date = toDate(value);
  const offset = calendarDay(date) - calendarDay(parseDateOnly(today));
  if (Math.abs(offset) <= 1) {
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    return capitalize(relative.format(offset, 'day'), locale);
  }
  return formatDate(date, locale);
}

/** Today's calendar date (`YYYY-MM-DD`) in the given IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return dateFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
