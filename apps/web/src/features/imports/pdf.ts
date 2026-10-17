/**
 * PDF statements (BR-26): rebuild the transaction table from the PDF text layer so the CSV
 * mapping step can read it. pdf.js loads only when a PDF is opened; everything below
 * `parsePdfStatement` is pure geometry over positioned text items.
 */

import type { Row } from './statement';

export const PDF_MAX_PAGES = 100;

export type PdfProblem = 'UNREADABLE' | 'PDF_NO_TEXT' | 'PDF_TOO_MANY_PAGES';

/** A text item in PDF user space: x/y is the baseline start, y grows upwards. */
type TextItem = { str: string; x: number; y: number; w: number; h: number };

/** The PDF itself, or the PDF inside a CMS SignedData wrapper (monobank, DSTU); null if neither. */
export function unwrapSignedPdf(bytes: Uint8Array): Uint8Array | null {
  if (startsWithPdf(bytes, 0)) return bytes;
  if (bytes[0] !== 0x30) return null;
  return findPdfOctets(bytes, 0, bytes.length);
}

const startsWithPdf = (bytes: Uint8Array, at: number) =>
  bytes[at] === 0x25 && bytes[at + 1] === 0x50 && bytes[at + 2] === 0x44 && bytes[at + 3] === 0x46;

/** One DER element: tag, content range. Null for BER indefinite lengths or a truncated file. */
function readElement(bytes: Uint8Array, at: number, end: number) {
  const tag = bytes[at]!;
  let length = bytes[at + 1]!;
  let content = at + 2;
  if (length & 0x80) {
    const size = length & 0x7f;
    // shortcut: definite lengths only (DER); a BER indefinite-length wrapper reads as unreadable.
    if (size === 0 || size > 4) return null;
    length = 0;
    for (let i = 0; i < size; i += 1) length = length * 256 + bytes[content + i]!;
    content += size;
  }
  const next = content + length;
  return next <= end ? { tag, content, next } : null;
}

/** Depth-first walk to the OCTET STRING holding the PDF, joining a chunked (constructed) one. */
function findPdfOctets(bytes: Uint8Array, start: number, end: number): Uint8Array | null {
  for (let at = start; at < end;) {
    const element = readElement(bytes, at, end);
    if (!element) return null;
    const { tag, content, next } = element;
    if (tag === 0x04 && startsWithPdf(bytes, content)) return bytes.subarray(content, next);
    if (tag === 0x24) {
      const chunks: Uint8Array[] = [];
      for (let c = content; c < next;) {
        const chunk = readElement(bytes, c, next);
        if (!chunk || chunk.tag !== 0x04) return null;
        chunks.push(bytes.subarray(chunk.content, chunk.next));
        c = chunk.next;
      }
      const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      if (startsWithPdf(joined, 0)) return joined;
    } else if (tag & 0x20) {
      const found = findPdfOctets(bytes, content, next);
      if (found) return found;
    }
    at = next;
  }
  return null;
}

type Line = { page: number; y: number; h: number; items: TextItem[] };
type Column = { label: string; center: number };
type Table = { text: string[]; labels: string[]; columns: Column[]; lines: Line[] };

const SAME_LINE = 2;
/** Lines of one cell or one header sit closer than this many text heights. */
const NEAR = 2.5;
const DATE_START =
  /^(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s+\p{L}{3,9}\.?\s+\d{4})/u;
const MONEY = /^[-+−]?\d{1,3}(?:[\s.,]?\d{3})*(?:[.,]\d{1,2})?\s*(?:\p{Sc}|[A-Z]{3})?$/u;
const SEPARATOR = /^[\s_\-–—]{5,}$/;
const VALUE_DATE = /^Value date:\s*/i;
const VALUE_DATE_LABEL = 'Value date';

const isData = (line: Line) => line.items.length >= 3 && DATE_START.test(line.items[0]!.str);
const isSeparator = (line: Line) => SEPARATOR.test(line.items.map((item) => item.str).join(' '));
const overlaps = (a: TextItem, b: TextItem) => a.x < b.x + b.w && b.x < a.x + a.w;
const near = (upper: Line, lower: Line) => upper.y - lower.y <= NEAR * Math.max(upper.h, lower.h);
const sameStrings = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((label, index) => label === b[index]);

function toLines(items: readonly TextItem[], page: number): Line[] {
  const lines: Line[] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.at(-1);
    if (line && line.y - item.y <= SAME_LINE) {
      line.items.push(item);
      line.h = Math.max(line.h, item.h);
    } else {
      lines.push({ page, y: item.y, h: item.h, items: [item] });
    }
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

/** A one-item line across several cells of a date line: a section banner (UkrSib's card name). */
const crossesRow = (line: Line, row: Line) =>
  line.items.length === 1 && row.items.filter((item) => overlaps(item, line.items[0]!)).length >= 3;

/**
 * The table header above the date line at `date`, looking no higher than `from`. Lines stacked
 * close together above it split into runs of one text size; the header is the lowest run that
 * names three or more columns across the date line's width, so a title above it is left out.
 * Null when the lines reach another date line: they were a cell continuation.
 */
function findHeader(
  lines: readonly Line[],
  from: number,
  date: number,
): { lines: Line[]; columns: Column[] } | null {
  const row = lines[date]!;
  let i = date - 1;
  while (i >= from && !isData(lines[i]!) && crossesRow(lines[i]!, row)) i -= 1;
  const runs: Line[][] = [];
  for (let below = lines[i + 1]!; i >= from && near(lines[i]!, below); below = lines[i]!, i -= 1) {
    const line = lines[i]!;
    if (isData(line) || isSeparator(line)) return null;
    if (runs[0] && Math.abs(runs[0][0]!.h - line.h) <= 0.5) runs[0].unshift(line);
    else runs.unshift([line]);
  }
  const rowLeft = row.items[0]!.x;
  const rowRight = row.items.at(-1)!.x + row.items.at(-1)!.w;
  for (const run of runs.reverse()) {
    const items = run.flatMap((line) => line.items);
    const columns = headerColumns(items);
    const left = Math.max(rowLeft, Math.min(...items.map((item) => item.x)));
    const right = Math.min(rowRight, Math.max(...items.map((item) => item.x + item.w)));
    if (columns.length >= 3 && (right - left) / (rowRight - rowLeft) >= 0.8)
      return { lines: run, columns };
  }
  return null;
}

/**
 * Stacked header labels that overlap horizontally form one column. A label spanning two
 * separate labels below it (UkrSib's "Операція" over "Валюта" and "Сума") prefixes both.
 */
function headerColumns(items: readonly TextItem[]): Column[] {
  const isGroup = (item: TextItem) => {
    const under = items.filter((other) => other.y < item.y && overlaps(item, other));
    return under.some((a) => under.some((b) => !overlaps(a, b)));
  };
  const groups = items.filter(isGroup);
  const clusters: TextItem[][] = [];
  let right = -Infinity;
  for (const item of items.filter((item) => !groups.includes(item)).sort((a, b) => a.x - b.x)) {
    if (item.x < right) clusters.at(-1)!.push(item);
    else clusters.push([item]);
    right = Math.max(right, item.x + item.w);
  }
  return clusters.map((cluster) => {
    const left = Math.min(...cluster.map((item) => item.x));
    const end = Math.max(...cluster.map((item) => item.x + item.w));
    const span = { str: '', x: left, y: 0, w: end - left, h: 0 };
    const label = [...groups.filter((group) => overlaps(group, span)), ...cluster]
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((item) => item.str.trim())
      .join(' ');
    return { label, center: (left + end) / 2 };
  });
}

/**
 * Column edges sit in the emptiest vertical strip between neighbouring header centres: cell
 * text is left-, right- or centre-aligned under its header, but never crosses the gutter.
 */
function columnEdges(columns: readonly Column[], lines: readonly Line[]): number[] {
  // 14,400 units is the largest PDF page: a giant glyph must not size the array to gigabytes.
  const right = Math.max(0, ...lines.flatMap((line) => line.items.map((item) => item.x + item.w)));
  const width = Math.ceil(Math.min(14_400, right) + 1);
  const coverage = new Array<number>(width).fill(0);
  for (const line of lines) {
    if (isSeparator(line)) continue;
    for (const item of line.items) {
      for (let x = Math.max(0, Math.floor(item.x)); x < Math.min(width, item.x + item.w); x += 1) {
        coverage[x]! += 1;
      }
    }
  }
  return columns.slice(1).map((column, index) => {
    const from = Math.ceil(columns[index]!.center);
    const to = Math.floor(column.center);
    let best = { at: (from + to) / 2, count: Infinity, run: 0 };
    for (let x = from; x <= to;) {
      const count = coverage[x] ?? 0;
      let end = x;
      while (end + 1 <= to && (coverage[end + 1] ?? 0) === count) end += 1;
      if (count < best.count || (count === best.count && end - x > best.run)) {
        best = { at: (x + end + 1) / 2, count, run: end - x };
      }
      x = end + 1;
    }
    return best.at;
  });
}

const lineText = (line: Line) => line.items.map((item) => item.str.trim()).join(' ');

/**
 * Splits the document into tables. Each starts at a header found above a date line; the same
 * header text on a later page continues the table. Lines above a header that hold no row (page
 * titles, the account holder block) are dropped.
 */
function splitTables(pages: readonly Line[][]): Table[] {
  const tables: Table[] = [];
  for (const lines of pages) {
    let body = 0;
    const startTable = (first: number, count: number, columns?: Column[]) => {
      const current = tables.at(-1);
      const before = lines.slice(body, first);
      if (current && before.some(isData)) current.lines.push(...before);
      const text = lines.slice(first, first + count).map(lineText);
      if (columns && !sameStrings(current?.text ?? [], text)) {
        tables.push({ text, labels: columns.map((column) => column.label), columns, lines: [] });
      }
      body = first + count;
    };
    for (let i = 0; i < lines.length; i += 1) {
      const repeat = tables.at(-1)?.text;
      if (repeat && repeat.every((text, k) => lines[i + k] && lineText(lines[i + k]!) === text)) {
        startTable(i, repeat.length);
        i = body - 1;
      } else if (isData(lines[i]!) && !(i > 0 && isData(lines[i - 1]!))) {
        const header = findHeader(lines, body, i);
        if (header)
          startTable(lines.indexOf(header.lines[0]!), header.lines.length, header.columns);
      }
    }
    tables.at(-1)?.lines.push(...lines.slice(body));
  }
  return tables;
}

/**
 * Rows of one table. A date line starts a row; the lines below it join its cells (a row may
 * continue on the next page) until a wide gap or a line with an amount (a totals line) ends it.
 */
function tableRows(table: Table): { headers: string[]; rows: string[][] } {
  const headers = [...table.labels];
  const valueDate = table.lines.some((line) =>
    line.items.some((item) => VALUE_DATE.test(item.str)),
  );
  if (valueDate) headers.push(VALUE_DATE_LABEL);
  const edges = columnEdges(table.columns, table.lines);
  const columnOf = (item: TextItem) => {
    if (valueDate && VALUE_DATE.test(item.str)) return headers.length - 1;
    const index = edges.findIndex((edge) => item.x + item.w / 2 < edge);
    return index < 0 ? edges.length : index;
  };
  const isBanner = (line: Line) =>
    line.items.length === 1 &&
    !isSeparator(line) &&
    edges.filter((edge) => line.items[0]!.x < edge && edge < line.items[0]!.x + line.items[0]!.w)
      .length >= 2;

  type Cells = { cells: string[][]; joins: Set<number> };
  const rows: Cells[] = [];
  const add = (row: Cells, line: Line) => {
    for (const item of line.items) {
      const column = columnOf(item);
      if (isSeparator(line)) {
        row.joins.add(column);
        continue;
      }
      const text = item.str.replace(VALUE_DATE, '').trim();
      const cell = row.cells[column]!;
      if (row.joins.delete(column) && cell.length > 0) cell.push('·');
      if (text !== '') cell.push(text);
    }
  };
  const holdsAmount = (row: Cells, line: Line) =>
    line.items.some((item) => MONEY.test(row.cells[columnOf(item)]!.join(' ')));

  let open = false;
  for (const [index, line] of table.lines.entries()) {
    if (isData(line)) {
      const row = { cells: headers.map(() => []), joins: new Set<number>() };
      add(row, line);
      rows.push(row);
      open = true;
      continue;
    }
    const row = rows.at(-1);
    const previous = table.lines[index - 1]!;
    if (!row || isBanner(line)) continue;
    if (previous.page !== line.page) open = true;
    else if (!isSeparator(line) && !near(previous, line)) open = false;
    if (open && holdsAmount(row, line)) open = false;
    if (open) add(row, line);
  }
  return {
    headers,
    rows: rows.map((row) => row.cells.map((cell) => cell.join(' ').replace(/\s+/g, ' ').trim())),
  };
}

/**
 * The statement table from each page's text items: the header row, then one row per
 * transaction; empty when no header with a date row below it is found. A later table with
 * every column of the first joins it by label (UkrSib's card operations add an authorization
 * code); one without (UkrSib's pending holds, no settlement date) is left out.
 */
function buildPdfTable(pages: readonly (readonly TextItem[])[]): Row[] {
  const [main, ...rest] = splitTables(pages.map((items, page) => toLines(items, page)));
  if (!main) return [];
  const tables = [
    main,
    ...rest.filter((table) => main.labels.every((label) => table.labels.includes(label))),
  ];
  const parts = tables.map(tableRows);
  const headers = [...new Set(parts.flatMap((part) => part.headers))];
  const rows = parts.flatMap((part) =>
    part.rows.map((cells) => headers.map((header) => cells[part.headers.indexOf(header)] ?? '')),
  );
  if (rows.length === 0) return [];
  // `line` numbers transactions in file order; the header is line 0.
  return [headers, ...rows].map((cells, line) => ({ line, cells }));
}

/** The PDF's table as rows, header first, or why it cannot be read. */
export async function readPdf(bytes: Uint8Array): Promise<Row[] | { problem: PdfProblem }> {
  const pdf = unwrapSignedPdf(bytes);
  if (!pdf) return { problem: 'UNREADABLE' };
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Node (unit tests) runs pdf.js without a worker. Browsers load ours from our origin (CSP), built
  // as a .js asset because nginx's mime.types has no .mjs and nosniff refuses octet-stream.
  if (typeof Worker !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  // WebAssembly only decodes images; text extraction does not need it and the CSP forbids it.
  const task = pdfjs.getDocument({ data: pdf.slice(), useWasm: false, verbosity: 0 });
  try {
    const document = await task.promise;
    if (document.numPages > PDF_MAX_PAGES) return { problem: 'PDF_TOO_MANY_PAGES' };
    const pages: TextItem[][] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const content = await (await document.getPage(number)).getTextContent();
      pages.push(
        content.items.flatMap((item) =>
          'str' in item && item.str.trim() !== ''
            ? [
                {
                  str: item.str,
                  x: item.transform[4],
                  y: item.transform[5],
                  w: item.width,
                  h: item.height,
                },
              ]
            : [],
        ),
      );
    }
    if (pages.every((items) => items.length === 0)) return { problem: 'PDF_NO_TEXT' };
    return buildPdfTable(pages);
  } catch {
    return { problem: 'UNREADABLE' };
  } finally {
    await task.destroy();
  }
}
