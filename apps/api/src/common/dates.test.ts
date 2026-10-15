import { describe, expect, it } from 'vitest';
import { addDays, isCalendarDate } from './dates';

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
