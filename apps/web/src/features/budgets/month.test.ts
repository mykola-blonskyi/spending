import { describe, expect, it, vi } from 'vitest';
import { currentMonth, shiftMonth } from './month';

describe('shiftMonth', () => {
  it.each([
    ['2026-10', 1, '2026-11'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-03', -15, '2024-12'],
    ['2026-05', 0, '2026-05'],
  ])('%s shifted by %i is %s', (month, delta, expected) => {
    expect(shiftMonth(month, delta)).toBe(expected);
  });
});

describe('currentMonth', () => {
  it("follows the user's time zone across a month boundary", () => {
    vi.useFakeTimers({ now: new Date('2026-10-31T23:30:00Z') });
    try {
      expect(currentMonth('Europe/Kyiv')).toBe('2026-11');
      expect(currentMonth('America/New_York')).toBe('2026-10');
    } finally {
      vi.useRealTimers();
    }
  });
});
