import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AMOUNT_MINOR_MAX, DESCRIPTION_MAX, NOTE_MAX } from '../ledger/views';
import { convertToEurMinor, currencyExponent, parseCurrency, type CurrencyCode } from './money';

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
  it.each([
    ['EUR', 2],
    ['JPY', 0],
    ['KWD', 3],
    ['HUF', 2],
    ['IDR', 2],
    ['COP', 2],
    ['ISK', 0],
    ['CLP', 0],
    ['IQD', 3],
    ['KRW', 0],
    ['TND', 3],
  ] as const)('follows ISO 4217 minor units, not Intl, for %s', (code, digits) => {
    expect(currencyExponent(c(code))).toBe(digits);
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

const webMoney = readFileSync(
  resolve(__dirname, '../../../web/src/shared/format/money.ts'),
  'utf8',
);

describe('MINOR_DIGITS', () => {
  it('matches the web app’s copy for every code either side knows', () => {
    const source = webMoney;
    const table = /const MINOR_DIGITS[^{]*\{([^}]*)\}/.exec(source)![1]!;
    const web = new Map(
      [...table.matchAll(/([A-Z]{3}): (\d)/g)].map(([, code, digits]) => [code!, Number(digits)]),
    );
    expect(web.size).toBeGreaterThan(0);
    const codes = new Set([...web.keys(), ...Intl.supportedValuesOf('currency')]);
    for (const code of codes) {
      expect([code, currencyExponent(code)]).toEqual([code, web.get(code) ?? 2]);
    }
  });
});

describe('entry limits', () => {
  it('match the web app’s copies', () => {
    const web = (name: string) =>
      Number(new RegExp(`const ${name} = ([\\d_]+);`).exec(webMoney)![1]!.replaceAll('_', ''));
    expect(web('MAX_AMOUNT_MINOR')).toBe(AMOUNT_MINOR_MAX);
    expect(web('DESCRIPTION_MAX')).toBe(DESCRIPTION_MAX);
    expect(web('NOTE_MAX')).toBe(NOTE_MAX);
  });
});
