import { describe, expect, it } from 'vitest';
import { decodeStatement, detectDelimiter, parseCsv } from './csv';

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
      { line: 1, cells: ['a', 'b;c', 'say "hi"'] },
      { line: 2, cells: ['multi\nline', 'x'] },
    ]);
  });

  it('keeps empty cells and trims whitespace', () => {
    expect(parseCsv(' a ;; c', ';')).toEqual([{ line: 1, cells: ['a', '', 'c'] }]);
  });
});
