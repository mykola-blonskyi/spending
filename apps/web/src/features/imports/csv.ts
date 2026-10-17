/**
 * Reading a CSV statement in the browser (BR-26): decode and split into rows of cells. Pure
 * functions over the file's bytes and text; nothing here knows about columns or money.
 */
import type { Row } from './statement';

export type Encoding = 'utf-8' | 'windows-1252';
export type Delimiter = ';' | ',' | '\t';
const DELIMITERS: readonly Delimiter[] = [';', ',', '\t'];

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
