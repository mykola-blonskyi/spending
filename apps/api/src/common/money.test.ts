import { describe, expect, it } from 'vitest';
import {
  convertToEurMinor,
  currencyExponent,
  parseAmountToMinor,
  parseCurrency,
  type CurrencyCode,
} from './money';

const c = (code: string) => parseCurrency(code) as CurrencyCode;

describe('parseCurrency', () => {
  it('accepts ISO codes the runtime knows and rejects everything else', () => {
    expect(parseCurrency('USD')).toBe('USD');
    expect(parseCurrency('usd')).toBeNull();
    expect(parseCurrency('XXZ')).toBeNull();
    expect(parseCurrency('EURO')).toBeNull();
  });
});

describe('currencyExponent', () => {
  it('follows ISO 4217 minor units', () => {
    expect(currencyExponent(c('EUR'))).toBe(2);
    expect(currencyExponent(c('JPY'))).toBe(0);
    expect(currencyExponent(c('KWD'))).toBe(3);
  });
});

describe('convertToEurMinor', () => {
  it('converts USD cents with an ECB rate', () => {
    expect(convertToEurMinor(10_823, c('USD'), '1.0823')).toBe(10_000);
  });

  it('handles currencies without minor units', () => {
    expect(convertToEurMinor(16_250, c('JPY'), '162.50')).toBe(10_000);
  });

  it('rounds half to even', () => {
    expect(convertToEurMinor(1, c('USD'), '2')).toBe(0);
    expect(convertToEurMinor(3, c('USD'), '2')).toBe(2);
  });

  it('is exact where floating point is not', () => {
    expect(convertToEurMinor(1_000_000_003, c('GBP'), '0.8571000000')).toBe(1_166_725_006);
  });

  it('rejects amounts outside the positive safe range and overflowing results', () => {
    expect(() => convertToEurMinor(-8, c('USD'), '3')).toThrow(RangeError);
    expect(() => convertToEurMinor(1.5, c('USD'), '3')).toThrow(RangeError);
    expect(() => convertToEurMinor(Number.MAX_SAFE_INTEGER, c('JPY'), '0.0001')).toThrow(
      RangeError,
    );
  });

  it('rejects malformed or zero rates', () => {
    expect(() => convertToEurMinor(100, c('USD'), '0')).toThrow(RangeError);
    expect(() => convertToEurMinor(100, c('USD'), '1e3')).toThrow(RangeError);
  });
});

describe('parseAmountToMinor', () => {
  it.each([
    ['1.234,56', ',', 2, 123_456],
    ['-12,5', ',', 2, -1_250],
    ['1 234.5', '.', 2, 123_450],
    ['1,234.56', '.', 2, 123_456],
    ['+7', '.', 2, 700],
    ['1500', ',', 0, 1_500],
  ] as const)('parses %s', (text, sep, exponent, expected) => {
    expect(parseAmountToMinor(text, exponent, sep)).toBe(expected);
  });

  it.each([
    ['', ','],
    ['abc', ','],
    ['1,2,3', ','],
    ['12.345,678', ','],
    ['9'.repeat(20), ','],
    ['12,50', '.'],
    ['1.5', ','],
    ['1 2 3', '.'],
    ['1,2,3.4', '.'],
    ['1,234 567.00', '.'],
  ] as const)('rejects %s with %s as decimal separator', (text, sep) => {
    expect(parseAmountToMinor(text, 2, sep)).toBeNull();
  });
});
