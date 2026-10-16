/**
 * A bank statement file as one table of text cells, whatever its format (BR-26, BR-36). Each
 * reader turns its bytes into rows; finding the header and the limits are shared, so the
 * mapping, preview and import never see the format. Metadata above the header (names, IBAN,
 * tax id) stays in the browser: only mapped cells of data rows are sent.
 */
import { decodeStatement, type Delimiter, detectDelimiter, type Encoding, parseCsv } from './csv';
import { type PdfProblem, readPdf } from './pdf';
import { readXlsx } from './xlsx';

const MiB = 1024 * 1024;
export const MAX_BYTES = { csv: 2 * MiB, xlsx: 5 * MiB, pdf: 10 * MiB } as const;
export const ROWS_MAX = 5000;

/** `line` is the 1-based file line (CSV), sheet row (XLSX) or transaction (PDF) the row starts on. */
export type Row = { line: number; cells: string[] };

export type StatementFormat =
  | { kind: 'csv'; encoding: Encoding; delimiter: Delimiter }
  | { kind: 'xlsx' }
  | { kind: 'pdf' };

export type ParsedStatement = {
  format: StatementFormat;
  headers: string[];
  /** Data rows below the header. */
  rows: Row[];
};

export type StatementFailure =
  | { problem: 'TOO_LARGE'; maxBytes: number }
  | { problem: 'EMPTY' | 'TOO_MANY_ROWS' | 'LEGACY_XLS' | 'UNSUPPORTED' | PdfProblem };

const NUMBER_LIKE = /^[+-]?[\d.,\s]+$/;
const DATE_LIKE = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/;

const looksLikeData = (cell: string) => NUMBER_LIKE.test(cell) || DATE_LIKE.test(cell);
const filled = (row: readonly string[]) => row.filter((cell) => cell !== '').length;

/**
 * The header is the first row as wide as most of the file (banks put narrower metadata lines
 * above it) that names every column and holds no date or number. A metadata line padded to full
 * width ("Número de cuenta;ES98…;;;;" or "Exportado;15/10/2026;;;") fails one of those. Falls
 * back to looser matches for files whose header has a blank column, then -1 for no table.
 */
export function findHeaderRow(rows: readonly (readonly string[])[]): number {
  const widths = new Map<number, number>();
  for (const row of rows) {
    if (filled(row) >= 2) widths.set(row.length, (widths.get(row.length) ?? 0) + 1);
  }
  let width = 0;
  let count = 0;
  for (const [w, c] of widths) {
    if (c > count) [width, count] = [w, c];
  }
  if (width === 0) return -1;
  const candidates = rows.flatMap((row, index) =>
    row.length === width && filled(row) >= 2 ? [index] : [],
  );
  const noData = (index: number) => !rows[index]!.some(looksLikeData);
  const complete = (index: number) => filled(rows[index]!) === width;
  return (
    candidates.find((index) => complete(index) && noData(index)) ??
    candidates.find(noData) ??
    candidates[0] ??
    -1
  );
}

const startsWith = (bytes: Uint8Array, magic: readonly number[]) =>
  magic.every((byte, i) => bytes[i] === byte);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const PDF = [0x25, 0x50, 0x44, 0x46];
/** DER SEQUENCE with a long length, then the CMS signedData OID: monobank's signed PDF. */
const SIGNED = (head: Uint8Array) =>
  head[0] === 0x30 &&
  (head[1]! & 0x80) !== 0 &&
  head.subarray(0, 32).join(',').includes('42,134,72,134,247,13,1,7,2');

/** The format is read from the bytes, not the name: monobank's `.xls` is an XLSX zip. */
async function readRows(
  file: Blob,
): Promise<{ format: StatementFormat; rows: Row[] } | StatementFailure> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (startsWith(head, OLE)) return { problem: 'LEGACY_XLS' };
  const kind =
    startsWith(head, PDF) || SIGNED(head) ? 'pdf' : startsWith(head, ZIP) ? 'xlsx' : 'csv';
  if (file.size > MAX_BYTES[kind]) return { problem: 'TOO_LARGE', maxBytes: MAX_BYTES[kind] };
  const bytes = await file.arrayBuffer();
  if (kind === 'pdf') {
    const rows = await readPdf(new Uint8Array(bytes));
    return 'problem' in rows ? rows : { format: { kind }, rows };
  }
  if (kind === 'xlsx') {
    try {
      return { format: { kind }, rows: await readXlsx(new Uint8Array(bytes)) };
    } catch {
      return { problem: 'UNREADABLE' };
    }
  }
  const { text, encoding } = decodeStatement(bytes);
  const delimiter = detectDelimiter(text);
  return { format: { kind, encoding, delimiter }, rows: parseCsv(text, delimiter) };
}

/** Everything the mapping step needs, or why the file cannot be used. */
export async function parseStatement(
  file: Blob,
): Promise<{ ok: true; statement: ParsedStatement } | ({ ok: false } & StatementFailure)> {
  let read: Awaited<ReturnType<typeof readRows>>;
  try {
    read = await readRows(file);
  } catch {
    return { ok: false, problem: 'UNREADABLE' };
  }
  if ('problem' in read) return { ok: false, ...read };
  const { format, rows: all } = read;
  const headerIndex = findHeaderRow(all.map((row) => row.cells));
  if (headerIndex < 0) return { ok: false, problem: 'EMPTY' };
  const headers = all[headerIndex]!.cells;
  const rows = all.slice(headerIndex + 1).filter((row) => filled(row.cells) > 0);
  if (rows.length === 0) return { ok: false, problem: 'EMPTY' };
  if (rows.length > ROWS_MAX) return { ok: false, problem: 'TOO_MANY_ROWS' };
  return { ok: true, statement: { format, headers, rows } };
}
