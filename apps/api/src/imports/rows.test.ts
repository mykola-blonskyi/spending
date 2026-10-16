import { describe, expect, it } from 'vitest';
import { type CurrencyCode, parseCurrency } from '../common/money';
import { type ImportRowInput, validateRows } from './rows';

const EUR = parseCurrency('EUR') as CurrencyCode;
const row = (extra: Partial<ImportRowInput> = {}): ImportRowInput => ({
  line: 2,
  occurredOn: '2026-10-01',
  amountMinor: -1250,
  description: '  MERCADONA  ',
  ...extra,
});

describe('validateRows', () => {
  it('takes the kind from the sign and defaults the currency to the account', () => {
    const { valid, rejected } = validateRows(
      [row(), row({ line: 3, amountMinor: 250000, currency: 'USD', externalId: ' X1 ' })],
      EUR,
    );
    expect(rejected).toEqual([]);
    expect(valid).toEqual([
      {
        line: 2,
        occurredOn: '2026-10-01',
        kind: 'expense',
        amountMinor: 1250,
        currency: 'EUR',
        description: 'MERCADONA',
        externalId: null,
      },
      {
        line: 3,
        occurredOn: '2026-10-01',
        kind: 'income',
        amountMinor: 250000,
        currency: 'USD',
        description: 'MERCADONA',
        externalId: 'X1',
      },
    ]);
  });

  it.each([
    ['an impossible date', { occurredOn: '2026-02-30' }, 'INVALID_DATE'],
    ['a non-ISO date', { occurredOn: '01/10/2026' }, 'INVALID_DATE'],
    ['a date out of range', { occurredOn: '1969-12-31' }, 'INVALID_DATE'],
    ['a zero amount', { amountMinor: 0 }, 'INVALID_AMOUNT'],
    ['a fractional amount', { amountMinor: 12.5 }, 'INVALID_AMOUNT'],
    ['an unsafe amount', { amountMinor: 2 ** 53 }, 'INVALID_AMOUNT'],
    ['an amount above the BR-13 cap', { amountMinor: -(10 ** 12 + 1) }, 'INVALID_AMOUNT'],
    ['an unknown currency', { currency: 'ZZZ' }, 'INVALID_CURRENCY'],
    ['a lowercase currency', { currency: 'eur' }, 'INVALID_CURRENCY'],
    ['a long description', { description: 'x'.repeat(201) }, 'DESCRIPTION_TOO_LONG'],
    ['a long provider id', { externalId: 'x'.repeat(101) }, 'EXTERNAL_ID_TOO_LONG'],
  ] as const)('rejects %s', (_name, extra, reason) => {
    expect(validateRows([row(extra)], EUR)).toEqual({ valid: [], rejected: [{ line: 2, reason }] });
  });

  it('accepts a description of exactly 200 characters after trimming', () => {
    expect(validateRows([row({ description: ` ${'x'.repeat(200)} ` })], EUR).valid).toHaveLength(1);
  });

  it('rejects a repeated provider id after the first and keeps valid rows', () => {
    const { valid, rejected } = validateRows(
      [
        row({ line: 2, externalId: 'A' }),
        row({ line: 3, externalId: 'A' }),
        row({ line: 4, occurredOn: 'bad' }),
        row({ line: 5, externalId: 'B' }),
      ],
      EUR,
    );
    expect(valid.map((r) => r.line)).toEqual([2, 5]);
    expect(rejected).toEqual([
      { line: 3, reason: 'DUPLICATE_IN_FILE_EXTERNAL_ID' },
      { line: 4, reason: 'INVALID_DATE' },
    ]);
  });

  it('treats a blank provider id as absent', () => {
    expect(validateRows([row({ externalId: '  ' })], EUR).valid[0]!.externalId).toBeNull();
  });
});

describe('category hints', () => {
  it('carries the bank category and MCC through', () => {
    const { valid } = validateRows([row({ bankCategory: 'Кафе', mcc: '5812' })], EUR);
    expect(valid[0]).toMatchObject({ bankCategory: 'Кафе', mcc: '5812' });
  });
});
