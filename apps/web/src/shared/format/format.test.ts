import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  currencyExponent,
  formatDate,
  formatMoney,
  formatMonth,
  formatNumber,
  formatPercent,
  formatRelativeDay,
  minorToDecimalString,
  parseDateOnly,
  todayIn,
} from './index';

const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ').replace(/\u2212/g, '-');

describe('minorToDecimalString', () => {
  it.each([
    [1250, 2, '12.50'],
    [-1250, 2, '-12.50'],
    [5, 2, '0.05'],
    [-5, 2, '-0.05'],
    [0, 2, '0.00'],
    [1234, 0, '1234'],
    [1, 3, '0.001'],
    [Number.MAX_SAFE_INTEGER, 2, '90071992547409.91'],
    [123456789012345678901234567890n, 2, '1234567890123456789012345678.90'],
  ])('%s with exponent %s is %s', (minor, exponent, expected) => {
    expect(minorToDecimalString(minor, exponent)).toBe(expected);
  });

  it('rejects fractional minor units', () => {
    expect(() => minorToDecimalString(12.5, 2)).toThrow(RangeError);
  });
});

describe('formatMoney', () => {
  it('uses the ISO exponent of each currency', () => {
    expect(currencyExponent('EUR')).toBe(2);
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KWD')).toBe(3);
  });

  it('formats EUR, USD and JPY in English', () => {
    expect(formatMoney(1250, 'EUR', 'en')).toBe('€12.50');
    expect(formatMoney(123456, 'USD', 'en')).toBe('$1,234.56');
    expect(formatMoney(1234, 'JPY', 'en')).toBe('¥1,234');
    expect(plain(formatMoney(1234, 'KWD', 'en'))).toBe('KWD 1.234');
  });

  it('formats negatives and explicit signs', () => {
    expect(formatMoney(-1250, 'EUR', 'en')).toBe('-€12.50');
    expect(formatMoney(1250, 'EUR', 'en', { signDisplay: 'exceptZero' })).toBe('+€12.50');
    expect(formatMoney(0, 'EUR', 'en', { signDisplay: 'exceptZero' })).toBe('€0.00');
    expect(formatMoney(-1250, 'EUR', 'en', { signDisplay: 'never' })).toBe('€12.50');
  });

  it('applies Ukrainian, Russian and Spanish grouping and decimal separators', () => {
    expect(plain(formatMoney(123456789, 'EUR', 'uk'))).toBe('1 234 567,89 EUR');
    expect(plain(formatMoney(-123456789, 'EUR', 'ru'))).toBe('-1 234 567,89 €');
    expect(plain(formatMoney(123456789, 'EUR', 'es'))).toBe('1.234.567,89 €');
    expect(plain(formatMoney(1234, 'JPY', 'ru'))).toBe('1 234 ¥');
  });

  it('keeps every digit of amounts beyond float precision', () => {
    expect(formatMoney(Number.MAX_SAFE_INTEGER, 'EUR', 'en')).toBe('€90,071,992,547,409.91');
  });
});

describe('formatNumber and formatPercent', () => {
  it('groups by locale', () => {
    expect(formatNumber(1234567.5, 'en')).toBe('1,234,567.5');
    expect(plain(formatNumber(1234567.5, 'uk'))).toBe('1 234 567,5');
  });

  it('treats the value as a ratio', () => {
    expect(formatPercent(0.25, 'en')).toBe('25%');
    expect(plain(formatPercent(0.125, 'es', { maximumFractionDigits: 1 }))).toBe('12,5 %');
    expect(formatPercent(0.1, 'en', { signDisplay: 'exceptZero' })).toBe('+10%');
  });
});

describe('dates', () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it('parses date-only strings as local calendar dates', () => {
    const date = parseDateOnly('2026-01-01');
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 0, 1]);
    expect(() => parseDateOnly('2026-1-1')).toThrow(RangeError);
  });

  it('does not shift a date-only value to the previous day west of UTC', () => {
    expect(formatDate('2026-01-01', 'en')).toBe('Jan 1, 2026');
    expect(formatDate('2026-10-14', 'uk', { dateStyle: 'long' })).toBe('14 жовтня 2026 р.');
  });

  it('formats months as capitalized standalone labels', () => {
    expect(formatMonth('2026-10', 'en')).toBe('October 2026');
    expect(formatMonth('2026-10-01', 'uk')).toBe('Жовтень 2026 р.');
    expect(formatMonth('2026-03-31', 'es')).toBe('Marzo de 2026');
  });

  it('names nearby days and falls back to a date', () => {
    const today = new Date(2026, 9, 14, 23, 30);
    expect(formatRelativeDay('2026-10-14', 'en', today)).toBe('Today');
    expect(formatRelativeDay('2026-10-13', 'ru', today)).toBe('Вчера');
    expect(formatRelativeDay('2026-10-15', 'es', today)).toBe('Mañana');
    expect(formatRelativeDay('2026-10-01', 'en', today)).toBe('Oct 1, 2026');
  });

  it("gives today's date in the user's time zone, not the device's", () => {
    const instant = new Date('2026-10-14T23:30:00Z');
    expect(todayIn('Europe/Kyiv', instant)).toBe('2026-10-15');
    expect(todayIn('America/New_York', instant)).toBe('2026-10-14');
  });
});
