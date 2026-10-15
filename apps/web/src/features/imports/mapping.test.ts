import { describe, expect, it } from 'vitest';
import {
  detectPreset,
  exponentFor,
  isComplete,
  type Mapping,
  normalizeRow,
  parseAmountToMinor,
  parseDate,
  presetMapping,
} from './mapping';

const BBVA = ['Fecha', 'F.Valor', 'Concepto', 'Movimiento', 'Importe', 'Divisa', 'Disponible'];
const SANTANDER = ['Fecha Operación', 'Fecha Valor', 'Concepto', 'Importe', 'Saldo', 'Referencia'];

describe('presets', () => {
  it('recognizes each bank by its header row', () => {
    expect(detectPreset(BBVA)).toBe('bbva');
    expect(detectPreset(SANTANDER)).toBe('santander');
    expect(detectPreset(['Date', 'Amount', 'Memo'])).toBe('custom');
  });

  it('prefills Spanish formats and the mapped columns', () => {
    expect(presetMapping('bbva', BBVA)).toEqual({
      preset: 'bbva',
      columns: {
        date: 0,
        amount: 4,
        debit: null,
        credit: null,
        description: 2,
        externalId: null,
        currency: 5,
      },
      amountLayout: 'signed',
      dateFormat: 'dmy',
      decimal: ',',
    });
    expect(presetMapping('santander', SANTANDER).columns).toMatchObject({
      date: 0,
      description: 2,
      amount: 3,
      externalId: 5,
    });
  });

  it('guesses a custom file from common names and switches to debit/credit when needed', () => {
    const mapping = presetMapping('custom', ['Date', 'Description', 'Debit', 'Credit']);
    expect(mapping.amountLayout).toBe('split');
    expect(mapping.columns).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3 });
    expect(mapping.dateFormat).toBe('ymd');
    expect(mapping.decimal).toBe('.');
  });
});

describe('parseDate', () => {
  it('reads each format and rejects impossible dates', () => {
    expect(parseDate('05/10/2026', 'dmy')).toBe('2026-10-05');
    expect(parseDate('10/05/2026', 'mdy')).toBe('2026-10-05');
    expect(parseDate('2026-10-05', 'ymd')).toBe('2026-10-05');
    expect(parseDate('31/02/2026', 'dmy')).toBeNull();
    expect(parseDate('2026-10-05', 'dmy')).toBeNull();
    expect(parseDate('', 'dmy')).toBeNull();
  });

  it('rejects years the server refuses', () => {
    expect(parseDate('31/12/1969', 'dmy')).toBeNull();
    expect(parseDate('1970-01-01', 'ymd')).toBe('1970-01-01');
    expect(parseDate('2100-12-31', 'ymd')).toBe('2100-12-31');
    expect(parseDate('01/01/2101', 'mdy')).toBeNull();
  });
});

describe('parseAmountToMinor', () => {
  it('matches the API parser on the exact cases', () => {
    expect(parseAmountToMinor('1.234,56', 2, ',')).toBe(123456);
    expect(parseAmountToMinor('-12,5', 2, ',')).toBe(-1250);
    expect(parseAmountToMinor('1 234.5', 2, '.')).toBe(123450);
    expect(parseAmountToMinor('12,50', 2, '.')).toBeNull();
    expect(parseAmountToMinor('1,2345', 2, ',')).toBeNull();
    expect(parseAmountToMinor('1234', 0, '.')).toBe(1234);
    expect(parseAmountToMinor('abc', 2, '.')).toBeNull();
  });

  it('reads a Unicode minus sign and nothing else that is not a plain sign', () => {
    expect(parseAmountToMinor('\u221212,50', 2, ',')).toBe(-1250);
    expect(parseAmountToMinor('(12,50)', 2, ',')).toBeNull();
    expect(parseAmountToMinor('12,50-', 2, ',')).toBeNull();
    expect(parseAmountToMinor('12,50 EUR', 2, ',')).toBeNull();
  });

  it('accepts at most 10^12 minor units either way (BR-13)', () => {
    expect(parseAmountToMinor('-10000000000.00', 2, '.')).toBe(-1_000_000_000_000);
    expect(parseAmountToMinor('-10000000000.01', 2, '.')).toBeNull();
  });
});

describe('normalizeRow', () => {
  const signed: Mapping = {
    preset: 'bbva',
    columns: {
      date: 0,
      amount: 1,
      debit: null,
      credit: null,
      description: 2,
      externalId: 3,
      currency: 4,
    },
    amountLayout: 'signed',
    dateFormat: 'dmy',
    decimal: ',',
  };

  it('builds the API row from a signed amount', () => {
    expect(
      normalizeRow(
        { line: 7, cells: ['01/10/2026', '-12,50', 'MERCADONA', 'REF1', 'EUR'] },
        signed,
        () => 2,
      ),
    ).toEqual({
      line: 7,
      occurredOn: '2026-10-01',
      amountMinor: -1250,
      description: 'MERCADONA',
      externalId: 'REF1',
      currency: 'EUR',
      problems: [],
    });
  });

  it('maps debit to an expense and credit to income', () => {
    const split: Mapping = {
      ...signed,
      columns: { ...signed.columns, amount: null, debit: 1, credit: 2, description: 3 },
      amountLayout: 'split',
    };
    expect(
      normalizeRow({ line: 1, cells: ['01/10/2026', '12,50', '', 'Shop'] }, split, () => 2),
    ).toMatchObject({
      amountMinor: -1250,
      problems: [],
    });
    expect(
      normalizeRow({ line: 2, cells: ['01/10/2026', '', '100,00', 'Salary'] }, split, () => 2),
    ).toMatchObject({
      amountMinor: 10000,
    });
  });

  it('normalizes the currency cell and names one the server would refuse', () => {
    const exponentOf = (currency: string) => (currency === '' || currency === 'EUR' ? 2 : null);
    expect(
      normalizeRow(
        { line: 4, cells: ['01/10/2026', '-1,00', 'Shop', '', ' eur '] },
        signed,
        exponentOf,
      ),
    ).toMatchObject({ currency: 'EUR', amountMinor: -100, problems: [] });
    expect(
      normalizeRow(
        { line: 5, cells: ['01/10/2026', '-1,00', 'Shop', '', 'XXX'] },
        signed,
        exponentOf,
      ),
    ).toMatchObject({ currency: 'XXX', amountMinor: -100, problems: ['currency'] });
  });

  it('knows the digits of an ISO currency and refuses anything else', () => {
    expect(['', 'JPY', 'USD', '€', 'EURO', 'ZZZ'].map((code) => exponentFor(code, 3))).toEqual([
      3,
      0,
      2,
      null,
      null,
      null,
    ]);
  });

  it('keeps unreadable cells in a form the server rejects, and names the problem', () => {
    expect(
      normalizeRow({ line: 3, cells: ['bad', 'x', 'Shop', '', ''] }, signed, () => 2),
    ).toMatchObject({
      occurredOn: 'bad',
      amountMinor: 0,
      problems: ['date', 'amount'],
    });
  });
});

describe('isComplete', () => {
  it('needs date, description and the amount columns of the layout', () => {
    const mapping = presetMapping('bbva', BBVA);
    expect(isComplete(mapping)).toBe(true);
    expect(isComplete({ ...mapping, columns: { ...mapping.columns, amount: null } })).toBe(false);
    expect(isComplete({ ...mapping, amountLayout: 'split' })).toBe(false);
  });
});
