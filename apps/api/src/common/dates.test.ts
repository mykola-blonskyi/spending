import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, daysInMonth, isCalendarDate, todayIn } from './dates';

describe('isCalendarDate', () => {
  it.each(['2026-10-14', '2024-02-29', '1970-01-01'])('accepts %s', (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each(['2026-02-29', '2026-13-01', '2026-1-1', '2026-10-14T00:00', '', 'tomorrow'])(
    'rejects %j',
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );
});

describe('addDays', () => {
  it('crosses month and leap boundaries', () => {
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-14', -7)).toBe('2026-10-07');
  });
});

describe('todayIn', () => {
  it('reads the calendar date of the zone, not of UTC', () => {
    const instant = new Date('2026-10-31T23:30:00Z');
    expect(todayIn(instant, 'UTC')).toBe('2026-10-31');
    expect(todayIn(instant, 'Europe/Madrid')).toBe('2026-11-01');
    expect(todayIn(instant, 'America/New_York')).toBe('2026-10-31');
  });

  it('follows daylight saving changes', () => {
    expect(todayIn(new Date('2026-03-28T23:30:00Z'), 'Europe/Madrid')).toBe('2026-03-29');
    expect(todayIn(new Date('2026-11-01T04:30:00Z'), 'America/New_York')).toBe('2026-11-01');
    expect(todayIn(new Date('2026-11-01T03:30:00Z'), 'America/New_York')).toBe('2026-10-31');
  });
});

describe('daysBetween and daysInMonth', () => {
  it('counts calendar days across a leap day', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2026-03-01', '2026-02-28')).toBe(-1);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});
