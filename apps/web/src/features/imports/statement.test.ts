import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findHeaderRow, MAX_BYTES, parseStatement, ROWS_MAX } from './statement';

const file = (bytes: Uint8Array<ArrayBuffer> | string) => new Blob([bytes]);
const fixture = (name: string) => file(new Uint8Array(readFileSync(`e2e/fixtures/${name}`)));

describe('findHeaderRow', () => {
  it('skips metadata lines, including full-width ones with an account number or a date', () => {
    const rows = [
      ['Cuenta', 'ES12 3456'],
      ['Número de cuenta', 'ES98 0049 0001', '', ''],
      ['Exportado', '15/10/2026', '', ''],
      [],
      ['Fecha', 'Concepto', 'Importe', 'Divisa'],
      ['01/10/2026', 'MERCADONA', '-12,50', 'EUR'],
      ['02/10/2026', 'LIDL', '-8,00', 'EUR'],
    ];
    expect(findHeaderRow(rows)).toBe(4);
  });

  it('takes the first full-width row when every one has data, and -1 for no table', () => {
    expect(
      findHeaderRow([
        ['2026-10-01', '-1'],
        ['2026-10-02', '-2'],
      ]),
    ).toBe(0);
    expect(findHeaderRow([['just one cell'], []])).toBe(-1);
  });
});

describe('parseStatement', () => {
  it('returns headers and numbered data rows of a CSV', async () => {
    const result = await parseStatement(
      file('Título\n\nFecha;Importe\n01/10/2026;-1,00\n\n02/10/2026;-2,00\n'),
    );
    expect(result).toEqual({
      ok: true,
      statement: {
        format: { kind: 'csv', encoding: 'utf-8', delimiter: ';' },
        headers: ['Fecha', 'Importe'],
        rows: [
          { line: 4, cells: ['01/10/2026', '-1,00'] },
          { line: 6, cells: ['02/10/2026', '-2,00'] },
        ],
      },
    });
  });

  it('numbers rows by the file line they start on, past cells holding line breaks', async () => {
    const result = await parseStatement(
      file('Fecha;Concepto;Importe\r\n01/10/2026;"two\r\nlines";-1,00\r\n02/10/2026;x;-2,00\r\n'),
    );
    expect(result.ok && result.statement.rows.map((row) => row.line)).toEqual([2, 4]);
  });

  it('refuses an empty file and one with too many rows', async () => {
    expect(await parseStatement(file(''))).toEqual({ ok: false, problem: 'EMPTY' });
    expect(await parseStatement(file('Fecha;Importe\n'))).toEqual({ ok: false, problem: 'EMPTY' });
    const big = 'date,amount\n' + '2026-10-01,-1\n'.repeat(ROWS_MAX + 1);
    expect(await parseStatement(file(big))).toEqual({ ok: false, problem: 'TOO_MANY_ROWS' });
  });

  it('finds the header below each bank’s metadata block in its XLSX export', async () => {
    const read = async (name: string) => {
      const result = await parseStatement(fixture(name));
      if (!result.ok) throw new Error(result.problem);
      const { format, headers, rows } = result.statement;
      return { format, header: headers[0], first: rows[0]!.line, count: rows.length };
    };
    expect(await read('santander.xlsx')).toEqual({
      format: { kind: 'xlsx' },
      header: 'Transaction date',
      first: 9,
      count: 4,
    });
    expect(await read('monobank.xls')).toMatchObject({ header: 'Date and time', first: 23 });
    expect(await read('privatbank.xlsx')).toMatchObject({ header: 'Дата', first: 3, count: 6 });
  });

  it('tells a legacy binary .xls and a PDF apart from a CSV by their bytes', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(await parseStatement(file(ole))).toEqual({ ok: false, problem: 'LEGACY_XLS' });
    expect(await parseStatement(file('%PDF-1.7\n'))).toEqual({ ok: false, problem: 'UNSUPPORTED' });
    expect(await parseStatement(file('PK\u0003\u0004broken'))).toEqual({
      ok: false,
      problem: 'UNREADABLE',
    });
  });

  it('applies the size limit of the format the bytes are in', async () => {
    const csv = 'a,b\n'.padEnd(MAX_BYTES.csv + 1, 'x');
    expect(await parseStatement(file(csv))).toEqual({
      ok: false,
      problem: 'TOO_LARGE',
      maxBytes: MAX_BYTES.csv,
    });
    const zip = new Uint8Array(MAX_BYTES.xlsx + 1);
    zip.set([0x50, 0x4b, 0x03, 0x04]);
    expect(await parseStatement(file(zip))).toEqual({
      ok: false,
      problem: 'TOO_LARGE',
      maxBytes: MAX_BYTES.xlsx,
    });
  });
});
