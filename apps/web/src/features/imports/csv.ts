/**
 * Reading a bank statement in the browser (BR-26): decode, split, find the header. Pure
 * functions over the file's bytes and text; nothing here knows about columns or money.
 */

export const FILE_MAX_BYTES = 2 * 1024 * 1024;
export const ROWS_MAX = 5000;

export type Encoding = 'utf-8' | 'windows-1252';
export type Delimiter = ';' | ',' | '\t';
export const DELIMITERS: readonly Delimiter[] = [';', ',', '\t'];

/** UTF-8 when the bytes are valid UTF-8 (the BOM is dropped), else Windows-1252. */
export function decodeStatement(bytes: ArrayBuffer): { text: string; encoding: Encoding } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

/**
 * The delimiter most first lines agree on: the one with the most lines at its median count per
 * line, the wider median breaking a tie. Bank metadata lines and commas inside descriptions or
 * amounts vary from line to line, so they lose to the real separator even when they outnumber it.
 */
export function detectDelimiter(text: string, sampleLines = 50): Delimiter {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, sampleLines);
  let best: Delimiter = ',';
  let bestLines = 0;
  let bestWidth = 0;
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => line.split(delimiter).length - 1);
    const sorted = [...counts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    if (median === 0) continue;
    const agreeing = counts.filter((count) => count === median).length;
    if (agreeing > bestLines || (agreeing === bestLines && median > bestWidth)) {
      best = delimiter;
      bestLines = agreeing;
      bestWidth = median;
    }
  }
  return best;
}

type Row = { line: number; cells: string[] };

/**
 * RFC 4180: quoted fields may hold the delimiter, doubled quotes and line breaks. Each record
 * keeps the 1-based file line it starts on.
 */
export function parseCsv(text: string, delimiter: Delimiter): Row[] {
  const rows: Row[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n' || (char === '\r' && text[i + 1] !== '\n')) line += 1;
        cell += char;
      }
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push({ line: start, cells: row });
      row = [];
      cell = '';
      line += 1;
      start = line;
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push({ line: start, cells: row });
  }
  return rows.map((record) => ({ ...record, cells: record.cells.map((value) => value.trim()) }));
}

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

export type ParsedStatement = {
  encoding: Encoding;
  delimiter: Delimiter;
  headers: string[];
  /** Data rows below the header, each with the 1-based file line it starts on. */
  rows: Row[];
};

export type StatementProblem = 'EMPTY' | 'TOO_MANY_ROWS';

/** Everything the mapping step needs, or why the file cannot be used. */
export function parseStatement(
  bytes: ArrayBuffer,
): { ok: true; statement: ParsedStatement } | { ok: false; problem: StatementProblem } {
  const { text, encoding } = decodeStatement(bytes);
  const delimiter = detectDelimiter(text);
  const all = parseCsv(text, delimiter);
  const headerIndex = findHeaderRow(all.map((row) => row.cells));
  if (headerIndex < 0) return { ok: false, problem: 'EMPTY' };
  const headers = all[headerIndex]!.cells;
  const rows = all.slice(headerIndex + 1).filter((row) => filled(row.cells) > 0);
  if (rows.length === 0) return { ok: false, problem: 'EMPTY' };
  if (rows.length > ROWS_MAX) return { ok: false, problem: 'TOO_MANY_ROWS' };
  return { ok: true, statement: { encoding, delimiter, headers, rows } };
}
