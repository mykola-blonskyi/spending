import { describe, expect, it } from 'vitest';
import type { DataExport } from '@data/data-rights';
import { csvCell, csvRow, transactionsCsv } from './transactions-csv';

describe('csvCell', () => {
  it.each([
    ['plain', 'plain'],
    ['', ''],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['cr\rhere', '"cr\rhere"'],
    ['=1+1', "'=1+1"],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tx', "'\tx"],
    ['\rx', `"'\rx"`],
    ['=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
    ['1.50', '1.50'],
    ['a=b', 'a=b'],
  ])('renders %j as %j', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });
});

describe('csvRow', () => {
  it('joins escaped cells and ends with CRLF', () => {
    expect(csvRow(['a', 'b,c', '=d'])).toBe(`a,"b,c",'=d\r\n`);
  });
});

describe('transactionsCsv', () => {
  type Row = DataExport['transactions'][number];
  const row = (patch: Partial<Row> = {}): Row =>
    ({
      reviewStatus: 'confirmed',
      occurredOn: '2026-10-01',
      kind: 'expense',
      amountMinor: 150,
      currency: 'EUR',
      baseAmountMinor: 150,
      fx: null,
      scope: 'personal',
      workspaceId: 'w',
      accountId: null,
      categoryId: null,
      description: 'd',
      note: '',
      source: 'manual',
      author: { userId: 'u', displayName: 'Ann' },
      ...patch,
    }) as Row;
  const documentOf = (...transactions: Row[]) =>
    ({
      workspaces: [{ id: 'w', name: 'Home' }],
      accounts: [{ id: 'a', name: 'Visa, "gold"' }],
      categories: [
        { id: 'c-default', name: null, systemKey: 'groceries' },
        { id: 'c-renamed', name: 'Food', systemKey: 'groceries' },
      ],
      transactions,
    }) as unknown as DataExport;
  const names = {
    header: (column: string) => `H:${column}`,
    category: (c: DataExport['categories'][number]) => c.name ?? `Продукти(${c.systemKey})`,
    formerMember: 'Former member',
  };
  const lines = (...transactions: Row[]) =>
    transactionsCsv(documentOf(...transactions), names).split('\r\n');
  const cells = (transaction: Row) => lines(transaction)[1]!.split(',');

  it('writes the headers through the resolver, in the fixed order', () => {
    expect(lines()).toEqual([
      'H:date,H:kind,H:amount,H:currency,H:eurAmount,H:fxRate,H:fxRateDate,H:scope,H:workspace,H:account,H:category,H:description,H:note,H:source,H:author',
      '',
    ]);
  });

  it('quotes an account with a comma and quotes, and a multi-line note', () => {
    expect(lines(row({ accountId: 'a', note: 'a,b\n"c"' }))[1]).toBe(
      `2026-10-01,expense,1.50,EUR,1.50,,,personal,Home,"Visa, ""gold""",,d,"a,b\n""c""",manual,Ann`,
    );
  });

  it.each([
    ['JPY', 12345, '12345'],
    ['KWD', 1234, '1.234'],
    ['EUR', 150, '1.50'],
    ['XYZ', 150, '1.50'],
  ])('writes %s %d as %s', (currency, amountMinor, expected) => {
    expect(cells(row({ currency, amountMinor })).slice(2, 4)).toEqual([expected, currency]);
  });

  it('writes the EUR columns, empty without a EUR amount', () => {
    const converted = row({
      currency: 'JPY',
      amountMinor: 12345,
      baseAmountMinor: 7692,
      fx: { rate: '160.5000000000', rateDate: '2026-10-01' } as Row['fx'],
    });
    expect(cells(converted).slice(4, 7)).toEqual(['76.92', '160.5000000000', '2026-10-01']);
    expect(cells(row({ baseAmountMinor: null })).slice(4, 7)).toEqual(['', '', '']);
  });

  it('names a default category through the resolver and keeps a renamed one', () => {
    expect(cells(row({ categoryId: 'c-default' }))[10]).toBe('Продукти(groceries)');
    expect(cells(row({ categoryId: 'c-renamed' }))[10]).toBe('Food');
  });

  it('labels a former member', () => {
    expect(cells(row({ author: { userId: null, displayName: null } }))[14]).toBe('Former member');
  });

  it('skips rows pending review', () => {
    expect(
      lines(row({ description: 'kept' }), row({ reviewStatus: 'pending_review' as never })),
    ).toHaveLength(3);
  });
});
