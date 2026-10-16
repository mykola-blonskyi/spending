import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readXlsx } from './xlsx';

const fixture = (name: string) => new Uint8Array(readFileSync(`e2e/fixtures/${name}`));

describe('readXlsx', () => {
  it('reads inline strings, numbers, date serials and sparse rows of the first sheet', async () => {
    expect(await readXlsx(fixture('features.xlsx'))).toEqual([
      { line: 1, cells: ['Date', 'Description', 'Amount', '', ''] },
      { line: 2, cells: ['2026-10-16', 'Inline & escaped <text>', '-12.5', '', ''] },
      { line: 3, cells: ['2026-10-17', 'Second', '0.3', '', ''] },
      { line: 4, cells: ['', 'Sparse', '', '', 'far'] },
    ]);
  });

  it('reads shared strings and numbers as Excel shows them, numbered by sheet row', async () => {
    const rows = await readXlsx(fixture('monobank.xls'));
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
    await expect(readXlsx(new TextEncoder().encode('PK\u0003\u0004 not a zip'))).rejects.toThrow();
  });
});
