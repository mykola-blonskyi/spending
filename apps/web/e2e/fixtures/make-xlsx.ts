/**
 * Writes the synthetic XLSX statements next to this file: `node e2e/fixtures/make-xlsx.ts`.
 * Each copies the layout of a real bank export (metadata block, header row, cell types) with
 * invented people, cards and IBANs. Real statements are never committed (#101, decision 16).
 */
import { writeFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';

type Cell = string | number | { inline: string } | { serial: number; style: 1 | 2 } | null;
type Sheet = { rows: Cell[][]; merges?: string[]; sharedStrings?: boolean };

const xml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// shortcut: single-letter columns only, enough for bank exports up to column Z.
const column = (index: number) => String.fromCharCode(65 + index);

function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const packed = deflateRawSync(data);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    // Bit 3: sizes live in the central directory only, as Santander's export writes them.
    local.writeUInt16LE(0x0808, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0808, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function workbook({ rows, merges = [], sharedStrings = true }: Sheet): Buffer {
  const strings: string[] = [];
  const cellXml = (cell: Cell, ref: string) => {
    if (cell === null) return '';
    if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
    if (typeof cell === 'object' && 'serial' in cell)
      return `<c r="${ref}" s="${cell.style}"><v>${cell.serial}</v></c>`;
    const text = typeof cell === 'string' ? cell : cell.inline;
    if (typeof cell === 'object' || !sharedStrings)
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
    strings.push(text);
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
  };
  const sheetRows = rows
    .map((cells, r) =>
      cells.length === 0
        ? ''
        : `<row r="${r + 1}">${cells.map((cell, c) => cellXml(cell, `${column(c)}${r + 1}`)).join('')}</row>`,
    )
    .join('');
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';
  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${rel}"><workbookPr date1904="false"/><sheets><sheet name="Statement" sheetId="1" r:id="rId3"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${ns}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${xml(s)}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}" xmlns:r="${rel}"><sheetData>${sheetRows}</sheetData>${mergeXml}</worksheet>`,
  });
}

const blank = (width: number): Cell[] => Array<Cell>(width).fill('');

/** English Santander online-banking export: every cell is text, amounts carry "€". */
const santander: Sheet = {
  merges: ['A1:B3'],
  rows: [
    [null, null, 'Account', 'Date'],
    [null, null, 'ES00 0000 1111 2222 3333 4444', '16/10/2026 | 09:30:00'],
    [null, null, 'Holder', 'Balance'],
    [null, null, 'LUCIA PRUEBA EJEMPLO', '2.125,69€ EUR'],
    [],
    ['Transactions', null, null, null, null, null],
    [],
    ['Transaction date', 'Value date', 'Description', 'Amount', 'Balance', 'Currency'],
    [
      '07/10/2026',
      '08/10/2026',
      'Recibo Electricidad Ejemplo, Madrid',
      '-60,00€',
      '2.125,69€',
      'EUR',
    ],
    ['05/10/2026', '06/10/2026', 'Compra Cafeteria Luna, Madrid', '-3,20€', '2.185,69€', 'EUR'],
    [
      '03/10/2026',
      '03/10/2026',
      'Transferencia De Empresa Ejemplo Sl',
      '1.234,56€',
      '2.188,89€',
      'EUR',
    ],
    ['01/10/2026', '02/10/2026', 'Pago Movil En Mercadona, Madrid', '-45,67€', '954,33€', 'EUR'],
  ],
};

const MONO_HEADER = [
  'Date and time',
  'Description',
  'MCC',
  'Card currency amount, (UAH)',
  'Operation amount',
  'Operation currency',
  'Exchange rate',
  'Commission, (UAH)',
  'Cashback amount, (UAH)',
  'Balance',
];

/** monobank "XLS" export: OOXML under an .xls name, metadata block, header at row 22. */
const monobank: Sheet = {
  merges: ['A20:I20'],
  rows: [
    ['Client: Olena Probna'],
    ['Date of birth: 01.02.1990'],
    ['ITN: 1234567890'],
    [''],
    ['Ukrainian passport:  XX 000000'],
    ['Issued by: Test office 0000'],
    ['Date of issue: 01.01.2010'],
    ['Registration address: 00000, Testville, Example street 1'],
    [''],
    ['Card number: 5375 **** **** 0000, 4441 **** **** 0000'],
    ['IBAN: UA000000000000000000000000000'],
    ['Period: 01.10.2026 – 16.10.2026'],
    [''],
    ['Credit limit (as of 16.10.2026): 0.00 UAH'],
    ['Indebtedness (as of 16.10.2026): 0.00 UAH'],
    [''],
    ['Balance at the beginning of the period: 1000.00'],
    ['Balance at the end of the period: 1814.38'],
    [''],
    ['Deposits are guaranteed by law. This line is a stand-in.', ...blank(8)],
    [],
    MONO_HEADER,
    ['08.10.2026 21:05:33', 'ATM Example', '6011', -500, -500, 'UAH', '—', '—', '—', 1814.38],
    [
      '06.10.2026 10:00:00',
      'From: Petro Probnyi',
      '4829',
      2000,
      2000,
      'UAH',
      '—',
      '—',
      '—',
      2314.38,
    ],
    [
      '04.10.2026 18:40:12',
      'Netflix',
      '4899',
      -435.12,
      -9.99,
      'USD',
      43.556,
      '—',
      '—',
      314.37999999999994,
    ],
    ['02.10.2026 09:15:00', 'Silpo', '5411', -250.5, -250.5, 'UAH', '—', '—', 2.51, 749.5],
  ],
};

/** PrivatBank: merged title row, header at row 2, two cards (UAH and EUR) in one sheet. */
const UAH_CARD = '5168 **** **** 0001';
const EUR_CARD = '4149 **** **** 0002';
const privatbank: Sheet = {
  merges: ['A1:J1'],
  rows: [
    ['Історія операцій за період 01.10.2026 - 16.10.2026'],
    [
      'Дата',
      'Категорія',
      'Картка',
      'Опис операції',
      'Сума в валюті картки',
      'Валюта картки',
      'Сума в валюті транзакції',
      'Валюта транзакції',
      'Залишок на кінець періоду',
      'Валюта залишку',
    ],
    [
      '10.10.2026 20:15:00',
      'Ресторани',
      EUR_CARD,
      'Restaurant Lisboa',
      -30.5,
      'EUR',
      30.5,
      'EUR',
      40.51,
      'EUR',
    ],
    [
      '09.10.2026 09:00:00',
      'Надходження',
      UAH_CARD,
      'Зарахування зарплати',
      15000,
      'UAH',
      15000,
      'UAH',
      19584.6,
      'UAH',
    ],
    [
      '07.10.2026 12:30:00',
      'Перекази',
      EUR_CARD,
      'Переказ з картки',
      20,
      'EUR',
      20,
      'EUR',
      74.01,
      'EUR',
    ],
    [
      '05.10.2026 08:45:00',
      'Кафе',
      UAH_CARD,
      "Кав'ярня Зерно",
      -95,
      'UAH',
      95,
      'UAH',
      4584.6,
      'UAH',
    ],
    [
      '03.10.2026 06:10:00',
      'Подорожі',
      EUR_CARD,
      'Ryanair',
      -45.99,
      'EUR',
      45.99,
      'EUR',
      54.01,
      'EUR',
    ],
    [
      '01.10.2026 08:00:00',
      'Продукти',
      UAH_CARD,
      'АТБ, Київ',
      -320.4,
      'UAH',
      320.4,
      'UAH',
      4679.6,
      'UAH',
    ],
  ],
};

/** PrivatBank with the bank's category column only, one UAH card: for category hints. */
const privatbankHints: Sheet = {
  merges: ['A1:J1'],
  rows: [
    privatbank.rows[0]!,
    privatbank.rows[1]!,
    [
      '12.10.2026 10:00:00',
      'Комуналка та Інтернет',
      UAH_CARD,
      'Київводоканал',
      -480.5,
      'UAH',
      480.5,
      'UAH',
      4519.5,
      'UAH',
    ],
    [
      '11.10.2026 10:00:00',
      'Різне',
      UAH_CARD,
      'Невідома крамниця',
      -100,
      'UAH',
      100,
      'UAH',
      5000,
      'UAH',
    ],
  ],
};

/** Reader edge cases: inline strings, a sparse row, date serials with and without a time. */
const features: Sheet = {
  sharedStrings: false,
  rows: [
    ['Date', 'Description', 'Amount'],
    [{ serial: 46311, style: 1 }, { inline: 'Inline & escaped <text>' }, -12.5],
    [{ serial: 46312.75, style: 2 }, 'Second', 0.1 + 0.2],
    [null, 'Sparse', null, null, 'far'],
  ],
};

const here = (name: string) => new URL(name, import.meta.url);
writeFileSync(here('santander.xlsx'), workbook(santander));
writeFileSync(here('monobank.xls'), workbook(monobank));
writeFileSync(here('privatbank.xlsx'), workbook(privatbank));
writeFileSync(here('privatbank-hints.xlsx'), workbook(privatbankHints));
writeFileSync(here('features.xlsx'), workbook(features));
