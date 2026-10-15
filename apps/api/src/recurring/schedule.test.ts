import { describe, expect, it } from 'vitest';
import { todayIn } from '../common/dates';
import { nextOccurrence, occurrences, type Schedule } from './schedule';

const rule = (overrides: Partial<Schedule>): Schedule => ({
  frequency: 'monthly',
  interval: 1,
  startsOn: '2026-01-31',
  endsOn: null,
  ...overrides,
});

describe('occurrences', () => {
  it('clamps a monthly rule on the 31st to month ends and returns to the 31st', () => {
    expect(occurrences(rule({}), '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    expect(occurrences(rule({ startsOn: '2024-01-30' }), '2024-02-01', '2024-03-31')).toEqual([
      '2024-02-29',
      '2024-03-30',
    ]);
  });

  it('keeps Feb 29 in leap years and clamps to Feb 28 otherwise', () => {
    expect(
      occurrences(
        rule({ frequency: 'yearly', startsOn: '2024-02-29' }),
        '2024-01-01',
        '2028-12-31',
      ),
    ).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });

  it('steps weekly and monthly intervals from the start', () => {
    expect(
      occurrences(
        rule({ frequency: 'weekly', interval: 2, startsOn: '2026-10-01' }),
        '2026-10-01',
        '2026-11-15',
      ),
    ).toEqual(['2026-10-01', '2026-10-15', '2026-10-29', '2026-11-12']);
    expect(
      occurrences(rule({ interval: 3, startsOn: '2026-11-30' }), '2027-01-01', '2027-12-31'),
    ).toEqual(['2027-02-28', '2027-05-30', '2027-08-30', '2027-11-30']);
    expect(
      occurrences(
        rule({ frequency: 'yearly', interval: 2, startsOn: '2020-06-15' }),
        '2021-01-01',
        '2026-12-31',
      ),
    ).toEqual(['2022-06-15', '2024-06-15', '2026-06-15']);
  });

  it('counts daily rules across a leap day and skips the distant past', () => {
    expect(
      occurrences(
        rule({ frequency: 'daily', interval: 1, startsOn: '2000-01-01' }),
        '2024-02-28',
        '2024-03-01',
      ),
    ).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
  });

  it('stops at endsOn and never starts before startsOn', () => {
    expect(
      occurrences(
        rule({ startsOn: '2026-01-15', endsOn: '2026-03-15' }),
        '2025-01-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
    expect(occurrences(rule({ endsOn: '2026-01-30' }), '2026-01-01', '2026-12-31')).toEqual([]);
  });

  it('treats dates as calendar days, so DST changes move nothing', () => {
    const weekly = rule({ frequency: 'weekly', startsOn: '2026-03-22' });
    expect(occurrences(weekly, '2026-03-22', '2026-04-05')).toEqual([
      '2026-03-22',
      '2026-03-29',
      '2026-04-05',
    ]);
    // Due dates come from today in the rule's zone: the first hour of the DST day is still due.
    expect(todayIn(new Date('2026-03-28T23:30:00Z'), 'Europe/Madrid')).toBe('2026-03-29');
    expect(todayIn(new Date('2026-03-08T04:30:00Z'), 'America/New_York')).toBe('2026-03-07');
    expect(todayIn(new Date('2026-03-08T05:30:00Z'), 'America/New_York')).toBe('2026-03-08');
  });
});

describe('nextOccurrence', () => {
  it('advances to the first occurrence on or after a date', () => {
    expect(nextOccurrence(rule({}), '2026-02-01')).toBe('2026-02-28');
    expect(nextOccurrence(rule({}), '2026-02-28')).toBe('2026-02-28');
    expect(nextOccurrence(rule({}), '2025-06-01')).toBe('2026-01-31');
    expect(nextOccurrence(rule({ frequency: 'daily', interval: 3 }), '2026-02-02')).toBe(
      '2026-02-03',
    );
  });

  it('is null once the rule has ended', () => {
    expect(nextOccurrence(rule({ endsOn: '2026-03-31' }), '2026-04-01')).toBeNull();
    expect(nextOccurrence(rule({ endsOn: '2026-03-31' }), '2026-03-01')).toBe('2026-03-31');
  });
});
