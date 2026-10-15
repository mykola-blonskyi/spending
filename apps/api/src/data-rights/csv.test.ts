import { describe, expect, it } from 'vitest';
import { csvCell, csvRow, transactionsCsv } from './csv';
import type { DataExport } from './export-sections';

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
  const exportOf = (locale: string, currency = 'EUR') =>
    ({
      user: { locale },
      workspaces: [],
      accounts: [],
      categories: [],
      transactions: [
        {
          reviewStatus: 'confirmed',
          occurredOn: '2026-10-01',
          kind: 'expense',
          amountMinor: 150,
          currency,
          baseAmountMinor: 150,
          fx: null,
          scope: 'family',
          workspaceId: 'w',
          accountId: null,
          categoryId: null,
          description: 'd',
          note: '',
          source: 'manual',
          author: { userId: null, displayName: null },
        },
      ],
    }) as unknown as DataExport;
  const firstRow = (document: DataExport) =>
    transactionsCsv(document).trimEnd().split('\r\n')[1]!.split(',');

  it.each([
    ['en', 'former member'],
    ['uk', 'колишній учасник'],
    ['ru', 'бывший участник'],
    ['es', 'antiguo miembro'],
  ])('labels a deleted author in %s', (locale, label) => {
    expect(firstRow(exportOf(locale)).pop()).toBe(label);
  });

  it('exports a stored currency the runtime no longer knows with 2 decimals', () => {
    expect(firstRow(exportOf('en', 'XYZ')).slice(2, 4)).toEqual(['1.50', 'XYZ']);
  });
});
