import { describe, expect, it } from 'vitest';
import {
  balanceMismatches,
  detectPreset,
  exponentFor,
  isComplete,
  listCards,
  type Mapping,
  normalizeRow,
  parseAmountToMinor,
  parseDate,
  prepareRows,
  presetMapping,
  recallMapping,
  rememberMapping,
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
        card: null,
        balance: 6,
        bankCategory: null,
        mcc: null,
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
    expect(parseDate('5/10/2026', 'ymd')).toBeNull();
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
    expect(parseAmountToMinor('1.234,56', 2, ',', 'EUR')).toBe(123456);
    expect(parseAmountToMinor('-12,5', 2, ',', 'EUR')).toBe(-1250);
    expect(parseAmountToMinor('1 234.5', 2, '.', 'EUR')).toBe(123450);
    expect(parseAmountToMinor('12,50', 2, '.', 'EUR')).toBeNull();
    expect(parseAmountToMinor('1,2345', 2, ',', 'EUR')).toBeNull();
    expect(parseAmountToMinor('1234', 0, '.', 'JPY')).toBe(1234);
    expect(parseAmountToMinor('abc', 2, '.', 'EUR')).toBeNull();
    expect(parseAmountToMinor('1 234,50 грн', 2, ',', 'UAH')).toBe(123450);
    expect(parseAmountToMinor('-250.5 грн.', 2, '.', 'UAH')).toBe(-25050);
    expect(parseAmountToMinor('₴100.00', 2, '.', 'UAH')).toBe(10000);
    expect(parseAmountToMinor('-₴100.00', 2, '.', 'UAH')).toBe(-10000);
    expect(parseAmountToMinor('100 грн', 2, '.', 'EUR')).toBeNull();
  });

  it('reads a Unicode minus sign and nothing else that is not a plain sign', () => {
    expect(parseAmountToMinor('\u221212,50', 2, ',', 'EUR')).toBe(-1250);
    expect(parseAmountToMinor('(12,50)', 2, ',', 'EUR')).toBeNull();
    expect(parseAmountToMinor('12,50-', 2, ',', 'EUR')).toBeNull();
    expect(parseAmountToMinor('12,50 USD', 2, ',', 'EUR')).toBeNull();
  });

  it('accepts at most 10^12 minor units either way (BR-13)', () => {
    expect(parseAmountToMinor('-10000000000.00', 2, '.', 'EUR')).toBe(-1_000_000_000_000);
    expect(parseAmountToMinor('-10000000000.01', 2, '.', 'EUR')).toBeNull();
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
      card: null,
      balance: null,
      bankCategory: null,
      mcc: null,
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
        'EUR',
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
      normalizeRow({ line: 1, cells: ['01/10/2026', '12,50', '', 'Shop'] }, split, 'EUR'),
    ).toMatchObject({
      amountMinor: -1250,
      problems: [],
    });
    expect(
      normalizeRow({ line: 2, cells: ['01/10/2026', '', '100,00', 'Salary'] }, split, 'EUR'),
    ).toMatchObject({
      amountMinor: 10000,
    });
  });

  it('normalizes the currency cell and names one the server would refuse', () => {
    expect(
      normalizeRow({ line: 4, cells: ['01/10/2026', '-1,00', 'Shop', '', ' eur '] }, signed, 'EUR'),
    ).toMatchObject({ currency: 'EUR', amountMinor: -100, problems: [] });
    expect(
      normalizeRow({ line: 5, cells: ['01/10/2026', '-1,00', 'Shop', '', 'XXX'] }, signed, 'EUR'),
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
      normalizeRow({ line: 3, cells: ['bad', 'x', 'Shop', '', ''] }, signed, 'EUR'),
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

const SANTANDER_XLSX = [
  'Transaction date',
  'Value date',
  'Description',
  'Amount',
  'Balance',
  'Currency',
];
const MONO_EN = [
  'Date and time',
  'Description',
  'MCC',
  'Card currency amount, (UAH)',
  'Operation amount',
  'Operation currency',
  'Exchange rate',
  'Commission, (UAH)',
  'Cashback amount, (UAH)',
  'Balance',
];
const MONO_UK = [
  'Дата i час операції',
  'Деталі операції',
  'MCC',
  'Сума в валюті картки (EUR)',
  'Сума в валюті операції',
  'Валюта',
  'Курс',
  'Сума комісій (EUR)',
  'Сума кешбеку (EUR)',
  'Залишок після операції',
];
const PRIVAT = [
  'Дата',
  'Категорія',
  'Картка',
  'Опис операції',
  'Сума в валюті картки',
  'Валюта картки',
  'Сума в валюті транзакції',
  'Валюта транзакції',
  'Залишок на кінець періоду',
  'Валюта залишку',
];

describe('XLSX bank presets', () => {
  it('recognizes Santander, monobank in both languages and PrivatBank by their headers', () => {
    expect(detectPreset(SANTANDER_XLSX)).toBe('santander');
    expect(detectPreset(MONO_EN)).toBe('monobank');
    expect(detectPreset(MONO_UK)).toBe('monobank');
    expect(detectPreset(PRIVAT)).toBe('privatbank');
  });

  it('matches headers written with decomposed letters, as monobank’s Ukrainian XLSX has them', () => {
    const decomposed = MONO_UK.map((header) => header.normalize('NFD'));
    expect(presetMapping('monobank', decomposed).columns).toMatchObject({
      date: 0,
      description: 1,
    });
  });

  it('takes the transaction date, not the value date', () => {
    expect(presetMapping('santander', SANTANDER_XLSX)).toMatchObject({
      columns: { date: 0, description: 2, amount: 3, balance: 4, currency: 5 },
      dateFormat: 'dmy',
      decimal: ',',
    });
  });

  it('maps the card-currency amount and leaves operation currency, commission and cashback out', () => {
    for (const headers of [MONO_EN, MONO_UK]) {
      expect(presetMapping('monobank', headers)).toMatchObject({
        columns: {
          date: 0,
          description: 1,
          amount: 3,
          currency: null,
          card: null,
          balance: 9,
          mcc: 2,
          bankCategory: null,
        },
        dateFormat: 'dmy',
        decimal: '.',
      });
    }
    expect(presetMapping('privatbank', PRIVAT).columns).toEqual({
      date: 0,
      description: 3,
      amount: 4,
      currency: 5,
      card: 2,
      balance: 8,
      debit: null,
      credit: null,
      externalId: null,
      bankCategory: 1,
      mcc: null,
    });
  });

  it('sends the bank category and a four-digit MCC as hints, and drops anything else', () => {
    const privat = presetMapping('privatbank', PRIVAT);
    const row = (cells: string[]) => ({ line: 3, cells });
    const cells = ['10.10.2026', ' Комуналка та Інтернет ', 'c', 'Київводоканал', '-100', 'UAH'];
    expect(normalizeRow(row(cells), privat, 'UAH').bankCategory).toBe('Комуналка та Інтернет');
    expect(normalizeRow(row(['', '—', ...cells.slice(2)]), privat, 'UAH')).not.toHaveProperty(
      'bankCategory',
    );
    const mono = presetMapping('monobank', MONO_EN);
    const monoRow = (mcc: string) => row(['08.10.2026', 'Silpo', mcc, '-250.5']);
    expect(normalizeRow(monoRow('5411'), mono, 'UAH').mcc).toBe('5411');
    for (const bad of ['', '0', '54110', 'abcd', '—']) {
      expect(normalizeRow(monoRow(bad), mono, 'UAH')).not.toHaveProperty('mcc');
    }
  });
});

const SANTANDER_PDF = ['Transaction date', 'Transaction', 'Amount', 'Balance', 'Value date'];
const UKRSIB = [
  'Дата операції',
  'Дата розрахунку',
  'Опис операції',
  'Операція Валюта',
  'Операція Сума',
  'Сума в валюті рахунку',
  'Код авторизації',
];

describe('PDF bank presets', () => {
  it('recognizes Santander, monobank and UkrSibbank PDF tables', () => {
    expect(detectPreset(SANTANDER_PDF)).toBe('santander');
    expect(detectPreset(UKRSIB)).toBe('ukrsib');
    expect(detectPreset(UKRSIB.slice(0, 6))).toBe('ukrsib');
  });

  it('maps the account-currency amount and the operation date', () => {
    expect(presetMapping('santander', SANTANDER_PDF).columns).toMatchObject({
      date: 0,
      description: 1,
      amount: 2,
      balance: 3,
    });
    expect(presetMapping('ukrsib', UKRSIB)).toMatchObject({
      columns: { date: 0, description: 2, amount: 5, currency: null, balance: null },
      dateFormat: 'dmy',
      decimal: '.',
    });
  });
});

describe('value formats (#101, decision 5)', () => {
  it('drops the time of a date and keeps the printed day', () => {
    expect(parseDate('16.10.2026 23:59:59', 'dmy')).toBe('2026-10-16');
    expect(parseDate('16/10/2026 08:05', 'dmy')).toBe('2026-10-16');
  });

  it('reads an ISO date whatever the chosen format, as XLSX date cells give it', () => {
    expect(parseDate('2026-10-05', 'dmy')).toBe('2026-10-05');
    expect(parseDate('2026-10-05', 'mdy')).toBe('2026-10-05');
  });

  it('reads English and Spanish month names', () => {
    expect(parseDate('16 Oct 2026', 'dmy')).toBe('2026-10-16');
    expect(parseDate('30 Sept 2026', 'ymd')).toBe('2026-09-30');
    expect(parseDate('16 oct. 2026', 'dmy')).toBe('2026-10-16');
    expect(parseDate('3 ene 2026', 'dmy')).toBe('2026-01-03');
    expect(parseDate('3 de agosto de 2026', 'dmy')).toBeNull();
    expect(parseDate('31 Feb 2026', 'dmy')).toBeNull();
    expect(parseDate('16 Foo 2026', 'dmy')).toBeNull();
  });

  it('reads a currency symbol or code before or after the amount when it is the row currency', () => {
    expect(parseAmountToMinor('-9,99€', 2, ',', 'EUR')).toBe(-999);
    expect(parseAmountToMinor('1.234,56 €', 2, ',', 'EUR')).toBe(123456);
    expect(parseAmountToMinor('€ -12.50', 2, '.', 'EUR')).toBe(-1250);
    expect(parseAmountToMinor('-€12.50', 2, '.', 'EUR')).toBe(-1250);
    expect(parseAmountToMinor('12,50 eur', 2, ',', 'EUR')).toBe(1250);
    expect(parseAmountToMinor('UAH 100.00', 2, '.', 'UAH')).toBe(10000);
    expect(parseAmountToMinor('₴100.00', 2, '.', 'UAH')).toBe(10000);
    expect(parseAmountToMinor('-9,99€', 2, ',', 'USD')).toBeNull();
    expect(parseAmountToMinor('$12.50', 2, '.', 'EUR')).toBeNull();
  });

  it('accepts space and no-break space thousands and a trailing .0', () => {
    expect(parseAmountToMinor('1 234,56', 2, ',', 'EUR')).toBe(123456);
    expect(parseAmountToMinor('1 234,56', 2, ',', 'EUR')).toBe(123456);
    expect(parseAmountToMinor('-1500.0', 0, '.', 'JPY')).toBe(-1500);
    expect(parseAmountToMinor('12.50', 0, '.', 'JPY')).toBeNull();
    // Three zero digits read as a thousands group, so a wrong separator choice still fails.
    expect(parseAmountToMinor('1.000', 2, '.', 'EUR')).toBeNull();
  });

  it('treats a dash cell as empty', () => {
    const mapping = presetMapping('monobank', MONO_EN);
    const row = {
      line: 23,
      cells: ['02.10.2026 09:15:00', 'Silpo', '5411', '—', '', '', '', '', '', '—'],
    };
    expect(prepareRows([row], mapping, 'UAH', null).skipped).toEqual([row]);
  });
});

describe('prepareRows', () => {
  const privat = presetMapping('privatbank', PRIVAT);
  const row = (line: number, card: string, amount: string, currency: string, balance: string) => ({
    line,
    cells: [
      '01.10.2026 08:00:00',
      'Кафе',
      card,
      `Row ${line}`,
      amount,
      currency,
      '',
      '',
      balance,
      currency,
    ],
  });
  const rows = [
    row(3, '4149 **** **** 0002', '-30.5', 'EUR', '40.51'),
    row(4, '5168 **** **** 0001', '15000', 'UAH', '19584.6'),
    row(5, '4149 **** **** 0002', '20', 'EUR', '74.01'),
    row(6, '5168 **** **** 0001', '-95', 'UAH', '4584.6'),
    row(7, '4149 **** **** 0002', '-45.99', 'EUR', '54.01'),
  ];

  it('lists each card with its currency in file order', () => {
    expect(listCards(rows, privat)).toEqual([
      { card: '4149 **** **** 0002', currency: 'EUR', count: 3 },
      { card: '5168 **** **** 0001', currency: 'UAH', count: 2 },
    ]);
    expect(listCards(rows, presetMapping('monobank', MONO_EN))).toEqual([]);
  });

  it('keeps only the chosen card and flags the row its running balance does not follow', () => {
    const prepared = prepareRows(rows, privat, 'EUR', '4149 **** **** 0002');
    expect(prepared.entries.map((entry) => entry.normalized.amountMinor)).toEqual([
      -3050, 2000, -4599,
    ]);
    expect(prepared.balanceMismatches).toEqual([3]);
    expect(prepareRows(rows, privat, 'UAH', '5168 **** **** 0001').balanceMismatches).toEqual([]);
  });

  it('skips rows with no amount instead of sending them', () => {
    const prepared = prepareRows(
      [...rows, row(8, '5168 **** **** 0001', '', 'UAH', '')],
      privat,
      'UAH',
      '5168 **** **** 0001',
    );
    expect(prepared.skipped.map((r) => r.line)).toEqual([8]);
    expect(prepared.entries).toHaveLength(2);
  });
});

describe('balanceMismatches', () => {
  const chain = (balances: number[], amounts: number[]) =>
    balances.map((balanceMinor, i) => ({ line: i + 1, amountMinor: amounts[i]!, balanceMinor }));

  it('follows the file whether it lists the newest or the oldest row first', () => {
    expect(balanceMismatches(chain([100, 150, 120], [100, 50, -30]))).toEqual([]);
    expect(balanceMismatches(chain([120, 150, 100], [-30, 50, 100]))).toEqual([]);
    expect(balanceMismatches(chain([100, 150, 130, 140], [100, 50, -30, 10]))).toEqual([3]);
    expect(balanceMismatches(chain([140, 130, 150, 100], [10, -30, 50, 100]))).toEqual([2]);
  });

  it('skips rows without a readable balance', () => {
    expect(
      balanceMismatches([
        { line: 1, amountMinor: 5, balanceMinor: null },
        { line: 2, amountMinor: 5, balanceMinor: 10 },
      ]),
    ).toEqual([]);
  });
});

describe('remembered mappings', () => {
  const headers = ['Fecha', 'Texto', 'Valor'];

  it('recalls the last mapping used for the same header row on this device', () => {
    localStorage.clear();
    expect(recallMapping(headers)).toBeNull();
    const mapping = { ...presetMapping('custom', headers), dateFormat: 'dmy' as const };
    rememberMapping(headers, { ...mapping, columns: { ...mapping.columns, amount: 2 } });
    expect(recallMapping([' fecha', 'TEXTO', 'Valor '])).toMatchObject({
      dateFormat: 'dmy',
      columns: { amount: 2 },
    });
    expect(recallMapping(['Fecha', 'Texto'])).toBeNull();
  });

  it('ignores a stored value that is not a mapping for these headers', () => {
    localStorage.clear();
    rememberMapping(headers, presetMapping('custom', headers));
    const key = Object.keys(localStorage)[0]!;
    localStorage.setItem(key, JSON.stringify({ preset: 'custom', columns: { date: 9 } }));
    expect(recallMapping(headers)).toBeNull();
    localStorage.setItem(key, '{not json');
    expect(recallMapping(headers)).toBeNull();
  });
});
