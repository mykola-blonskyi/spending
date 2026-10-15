import { describe, expect, it } from 'vitest';
import {
  decodeStatement,
  detectDelimiter,
  findHeaderRow,
  parseCsv,
  parseStatement,
  ROWS_MAX,
} from './csv';

const utf8 = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const latin1 = (text: string) =>
  Uint8Array.from(text, (char) => char.charCodeAt(0)).buffer as ArrayBuffer;

describe('decodeStatement', () => {
  it('reads UTF-8 with and without a BOM', () => {
    expect(decodeStatement(utf8('﻿Fecha;Concepto\n'))).toEqual({
      text: 'Fecha;Concepto\n',
      encoding: 'utf-8',
    });
    expect(decodeStatement(utf8('Café')).text).toBe('Café');
  });

  it('falls back to Windows-1252 for bytes that are not UTF-8', () => {
    expect(decodeStatement(latin1('Última operación'))).toEqual({
      text: 'Última operación',
      encoding: 'windows-1252',
    });
  });
});

describe('detectDelimiter', () => {
  it('picks the separator that is stable across lines, not the one that appears most', () => {
    const text = [
      'Movimientos de la cuenta, exportados el 15/10/2026, 10:30',
      '',
      'Fecha;Concepto;Importe;Divisa',
      '01/10/2026;COMPRA EN MERCADONA, S.A.;-12,50;EUR',
      '02/10/2026;RECIBO LUZ, ENDESA;-60,00;EUR',
      '03/10/2026;NOMINA;1.234,56;EUR',
    ].join('\n');
    expect(detectDelimiter(text)).toBe(';');
  });

  it('prefers the separator every line agrees on over one that appears more often', () => {
    const text = [
      'Concepto;Importe',
      'COMPRA, MERCADONA, S.A.;-12,50',
      'RECIBO, ENDESA;-60,00',
      'NOMINA, ACME;1.234,56',
      'LUZ, GAS;-5,00',
    ].join('\n');
    expect(detectDelimiter(text)).toBe(';');
  });

  it('handles comma and tab files', () => {
    expect(detectDelimiter('date,amount,memo\n2026-10-01,-1.5,"Shop, Inc"\n')).toBe(',');
    expect(detectDelimiter('date\tamount\n2026-10-01\t-1.5\n')).toBe('\t');
  });
});

describe('parseCsv', () => {
  it('follows RFC 4180: quotes, doubled quotes, line breaks in cells, CRLF', () => {
    expect(parseCsv('a;"b;c";"say ""hi"""\r\n"multi\nline";x\n', ';')).toEqual([
      ['a', 'b;c', 'say "hi"'],
      ['multi\nline', 'x'],
    ]);
  });

  it('keeps empty cells and trims whitespace', () => {
    expect(parseCsv(' a ;; c', ';')).toEqual([['a', '', 'c']]);
  });
});

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
  it('returns headers and numbered data rows', () => {
    const result = parseStatement(
      utf8('Título\n\nFecha;Importe\n01/10/2026;-1,00\n\n02/10/2026;-2,00\n'),
    );
    expect(result).toEqual({
      ok: true,
      statement: {
        encoding: 'utf-8',
        delimiter: ';',
        headers: ['Fecha', 'Importe'],
        rows: [
          { line: 4, cells: ['01/10/2026', '-1,00'] },
          { line: 6, cells: ['02/10/2026', '-2,00'] },
        ],
      },
    });
  });

  it('refuses an empty file and one with too many rows', () => {
    expect(parseStatement(utf8(''))).toEqual({ ok: false, problem: 'EMPTY' });
    expect(parseStatement(utf8('Fecha;Importe\n'))).toEqual({ ok: false, problem: 'EMPTY' });
    const big = 'date,amount\n' + '2026-10-01,-1\n'.repeat(ROWS_MAX + 1);
    expect(parseStatement(utf8(big))).toEqual({ ok: false, problem: 'TOO_MANY_ROWS' });
  });
});
