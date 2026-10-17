/**
 * The first sheet of an XLSX workbook as rows of text cells, read in the browser with
 * `DecompressionStream` and `DOMParser` (#101, decision 3). Numbers come out as Excel shows them
 * with General format, date cells as `YYYY-MM-DD`. Throws on anything that is not a workbook.
 */
import type { Row } from './statement';

/** Bigger parts than this are not a bank statement; it also stops a zip bomb. */
const PART_MAX_BYTES = 64 * 1024 * 1024;
/** Self-closing rows are empty; any namespace prefix is allowed. */
const ROW_OPEN = /<(?:[\w.-]+:)?row\b[^>]*>/g;
/** shortcut: wider sheets are refused instead of read, raise it if a bank exports more columns. */
const COLUMNS_MAX = 100;
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOC_RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

type Entry = { method: number; offset: number; compressed: number; size: number };
/** `inflatedMax` bounds all parts together; `rowsMax` the sheet's non-empty rows. */
export type XlsxLimits = { inflatedMax: number; rowsMax: number };

export class TooManyRowsError extends Error {}

/** shortcut: no ZIP64 and no CRC check; statements are under 5 MiB and the XML parse fails on damage. */
function zipEntries(bytes: Uint8Array<ArrayBuffer>): Map<string, Entry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('no zip directory');
  const entries = new Map<string, Entry>();
  let at = view.getUint32(end + 16, true);
  for (let i = view.getUint16(end + 10, true); i > 0; i -= 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('bad zip entry');
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, {
      method: view.getUint16(at + 10, true),
      compressed: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
}

async function inflate(data: Uint8Array<ArrayBuffer>, limit: number): Promise<Uint8Array> {
  const reader = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  })
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error('workbook too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** A part's text, charged to `budget` so that all parts together stay under the limit. */
async function readText(
  bytes: Uint8Array<ArrayBuffer>,
  entries: Map<string, Entry>,
  name: string,
  budget: { left: number },
) {
  const entry = entries.get(name);
  if (!entry) return null;
  const limit = Math.min(PART_MAX_BYTES, budget.left);
  if (entry.size > limit) throw new Error('workbook too large');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error('bad zip entry');
  const start =
    entry.offset +
    30 +
    view.getUint16(entry.offset + 26, true) +
    view.getUint16(entry.offset + 28, true);
  const data = bytes.subarray(start, start + entry.compressed);
  const raw = entry.method === 0 ? data : entry.method === 8 ? await inflate(data, limit) : null;
  if (!raw) throw new Error('unsupported compression');
  if (raw.length > limit) throw new Error('workbook too large');
  budget.left -= raw.length;
  return new TextDecoder().decode(raw);
}

function parseXml(text: string | null, name: string) {
  if (text === null) return null;
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error(`bad XML in ${name}`);
  return doc;
}

function countRowsPast(text: string, max: number): boolean {
  let count = 0;
  for (const [tag] of text.matchAll(ROW_OPEN)) {
    if (!tag.endsWith('/>') && ++count > max) return true;
  }
  return false;
}

const children = (parent: Element | Document, ns: string, tag: string) =>
  Array.from(parent.getElementsByTagNameNS(ns, tag));

/** Text of a shared or inline string: its own `t`, or the `t` of each rich-text run, never phonetic hints. */
function stringText(si: Element): string {
  return Array.from(si.children)
    .flatMap((child) =>
      child.localName === 't'
        ? [child]
        : child.localName === 'r'
          ? Array.from(child.children).filter((t) => t.localName === 't')
          : [],
    )
    .map((t) => t.textContent ?? '')
    .join('');
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** Style indexes whose number format shows a day or a year: those numbers are date serials. */
function dateStyles(styles: Document | null): Set<number> {
  const result = new Set<number>();
  if (!styles) return result;
  const custom = new Map(
    children(styles, MAIN, 'numFmt').map((f) => [
      Number(f.getAttribute('numFmtId')),
      (f.getAttribute('formatCode') ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''),
    ]),
  );
  const cellXfs = children(styles, MAIN, 'cellXfs')[0];
  const xfs = cellXfs ? Array.from(cellXfs.children).filter((xf) => xf.localName === 'xf') : [];
  xfs.forEach((xf, index) => {
    const id = Number(xf.getAttribute('numFmtId') ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id) || /[dy]/i.test(custom.get(id) ?? '')) result.add(index);
  });
  return result;
}

function serialToDate(serial: number, date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

/** Excel shows 15 significant digits, which drops binary noise such as 314.37999999999994. */
const formatNumber = (value: string) => String(Number(Number(value).toPrecision(15)));

function columnIndex(ref: string): number {
  let index = 0;
  for (const char of /^[A-Z]+/.exec(ref)?.[0] ?? '') index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}

function firstSheetPath(workbook: Document, rels: Document | null): string {
  const sheet = children(workbook, MAIN, 'sheet')[0];
  const id = sheet?.getAttributeNS(DOC_RELS, 'id');
  const target =
    rels && children(rels, RELS, 'Relationship').find((r) => r.getAttribute('Id') === id);
  const path = target?.getAttribute('Target') ?? 'worksheets/sheet1.xml';
  return path.startsWith('/') ? path.slice(1) : `xl/${path}`;
}

export async function readXlsx(
  bytes: Uint8Array<ArrayBuffer>,
  { inflatedMax, rowsMax }: XlsxLimits,
): Promise<Row[]> {
  const entries = zipEntries(bytes);
  const budget = { left: inflatedMax };
  const readPart = async (name: string) =>
    parseXml(await readText(bytes, entries, name, budget), name);
  const workbook = await readPart('xl/workbook.xml');
  if (!workbook) throw new Error('no workbook');
  const rels = await readPart('xl/_rels/workbook.xml.rels');
  const sheetPath = firstSheetPath(workbook, rels);
  const sheetText = await readText(bytes, entries, sheetPath, budget);
  if (sheetText !== null && countRowsPast(sheetText, rowsMax)) throw new TooManyRowsError();
  const sheet = parseXml(sheetText, sheetPath);
  if (!sheet) throw new Error('no sheet');
  const shared = await readPart('xl/sharedStrings.xml');
  const strings = shared ? children(shared, MAIN, 'si').map(stringText) : [];
  const dates = dateStyles(await readPart('xl/styles.xml'));
  const pr = children(workbook, MAIN, 'workbookPr')[0]?.getAttribute('date1904');
  const date1904 = pr === '1' || pr === 'true';

  let width = 0;
  let previousLine = 0;
  const sparse = children(sheet, MAIN, 'row').map((row) => {
    const line = Number(row.getAttribute('r')) || previousLine + 1;
    previousLine = line;
    const cells = new Map<number, string>();
    let previousColumn = -1;
    for (const c of children(row, MAIN, 'c')) {
      const ref = c.getAttribute('r');
      const column = ref ? columnIndex(ref) : previousColumn + 1;
      previousColumn = column;
      const type = c.getAttribute('t') ?? 'n';
      const v = children(c, MAIN, 'v')[0]?.textContent ?? '';
      const is = children(c, MAIN, 'is')[0];
      const text = (
        type === 's'
          ? (strings[Number(v)] ?? '')
          : type === 'inlineStr'
            ? is
              ? stringText(is)
              : ''
            : type === 'n' && v !== ''
              ? dates.has(Number(c.getAttribute('s') ?? 0))
                ? serialToDate(Number(v), date1904)
                : formatNumber(v)
              : v
      ).trim();
      if (text === '') continue;
      if (column >= COLUMNS_MAX) throw new Error('too many columns');
      cells.set(column, text);
      width = Math.max(width, column + 1);
    }
    return { line, cells };
  });
  // Padded to one width, as a CSV export pads its metadata lines.
  return sparse.map(({ line, cells }) => ({
    line,
    cells: Array.from({ length: width }, (_, i) => cells.get(i) ?? ''),
  }));
}
