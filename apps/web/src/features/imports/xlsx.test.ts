import { readFileSync } from 'node:fs';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { workbook } from './testing';
import { readXlsx, TooManyRowsError } from './xlsx';

const fixture = (name: string) => new Uint8Array(readFileSync(`e2e/fixtures/${name}`));
const LIMITS = { inflatedMax: 128 * 1024 * 1024, rowsMax: 10_000 };
const row = (r: number, text: string) =>
  `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>${text}</t></is></c></row>`;

describe('readXlsx', () => {
  it('reads inline strings, numbers, date serials and sparse rows of the first sheet', async () => {
    expect(await readXlsx(fixture('features.xlsx'), LIMITS)).toEqual([
      { line: 1, cells: ['Date', 'Description', 'Amount', '', ''] },
      { line: 2, cells: ['2026-10-16', 'Inline & escaped <text>', '-12.5', '', ''] },
      { line: 3, cells: ['2026-10-17', 'Second', '0.3', '', ''] },
      { line: 4, cells: ['', 'Sparse', '', '', 'far'] },
    ]);
  });

  it('reads shared strings and numbers as Excel shows them, numbered by sheet row', async () => {
    const rows = await readXlsx(fixture('monobank.xls'), LIMITS);
    expect(rows[0]).toEqual({ line: 1, cells: ['Client: Olena Probna', ...Array(9).fill('')] });
    const header = rows.find((row) => row.line === 22)!;
    expect(header.cells[3]).toBe('Card currency amount, (UAH)');
    expect(rows.find((row) => row.line === 25)!.cells).toEqual([
      '04.10.2026 18:40:12',
      'Netflix',
      '4899',
      '-435.12',
      '-9.99',
      'USD',
      '43.556',
      '—',
      '—',
      '314.38',
    ]);
  });

  it('fails on bytes that are not a workbook', async () => {
    await expect(
      readXlsx(new TextEncoder().encode('PK\u0003\u0004 not a zip'), LIMITS),
    ).rejects.toThrow();
  });

  it('refuses a workbook whose parts together inflate past the limit', async () => {
    const bytes = workbook([row(1, 'a')], 3000);
    expect(await readXlsx(bytes, { ...LIMITS, inflatedMax: 12_000 })).toEqual([
      { line: 1, cells: ['a'] },
    ]);
    await expect(readXlsx(bytes, { ...LIMITS, inflatedMax: 8000 })).rejects.toThrow(
      'workbook too large',
    );
  });

  it('refuses a sheet past the row limit before parsing it, not counting empty rows', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => row(i + 1, `r${i}`));
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    onTestFinished(() => parse.mockRestore());
    await expect(readXlsx(workbook(rows), { ...LIMITS, rowsMax: 3 })).rejects.toBeInstanceOf(
      TooManyRowsError,
    );
    expect(parse.mock.calls.map(([text]) => text)).not.toContainEqual(
      expect.stringContaining('<sheetData>'),
    );
    const blanks = ['<row r="5"/>', '<row r="6" s="1" customFormat="1"/>'];
    const withBlanks = await readXlsx(workbook([...rows, ...blanks]), { ...LIMITS, rowsMax: 4 });
    expect(withBlanks.map((r) => r.line)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
