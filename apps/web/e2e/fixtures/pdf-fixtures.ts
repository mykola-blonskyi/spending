/**
 * Writes the synthetic PDF statements next to this file: `node e2e/fixtures/pdf-fixtures.ts`.
 * Layouts copy the geometry of real Santander, monobank and UkrSibbank statements; every person,
 * account, card and amount is invented. Text uses a Type0 font with an identity ToUnicode map,
 * so any BMP character (Cyrillic, €, ·) extracts as written without embedding a font.
 */
import { writeFileSync } from 'node:fs';

type Text = { x: number; y: number; size: number; str: string };
type Page = Text[];

const hex = (str: string) =>
  [...str].map((char) => char.codePointAt(0)!.toString(16).padStart(4, '0')).join('');
/** Item width as pdf.js measures it: the font's default width of half an em per character. */
const width = (str: string, size: number) => str.length * size * 0.5;
const right = (end: number, y: number, size: number, str: string): Text => ({
  x: end - width(str, size),
  y,
  size,
  str,
});
const center = (mid: number, y: number, size: number, str: string): Text => ({
  x: mid - width(str, size) / 2,
  y,
  size,
  str,
});

export function pdf(pages: Page[], extra = ''): Uint8Array {
  const toUnicode =
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap ' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def ' +
    '/CMapName /Adobe-Identity-UCS def /CMapType 2 def ' +
    '1 begincodespacerange <0000> <FFFF> endcodespacerange ' +
    '1 beginbfrange <0000> <FFFF> <0000> endbfrange ' +
    'endcmap CMapName currentdict /CMap defineresource pop end end';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${6 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /Helvetica /Encoding /Identity-H ' +
      '/DescendantFonts [4 0 R] /ToUnicode 5 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Helvetica /DW 500 ' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>',
    `<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}\nendstream`,
  ];
  for (const [index, page] of pages.entries()) {
    const content =
      extra +
      page
        .map(
          (t) => `BT /F1 ${t.size} Tf ${t.x.toFixed(2)} ${t.y.toFixed(2)} Td <${hex(t.str)}> Tj ET`,
        )
        .join('\n');
    objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${7 + index * 2} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  }
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = out.length;
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** DER TLV with a definite length. */
function der(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const size =
    length < 0x80
      ? [length]
      : (() => {
          const bytes: number[] = [];
          for (let rest = length; rest > 0; rest = Math.floor(rest / 256))
            bytes.unshift(rest % 256);
          return [0x80 | bytes.length, ...bytes];
        })();
  const out = new Uint8Array(1 + size.length + length);
  out.set([tag, ...size]);
  let at = 1 + size.length;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const OID_SIGNED_DATA = Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02);
const OID_DATA = Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01);

/**
 * A CMS SignedData shell around the PDF, as monobank sends it. The signer info is a stand-in:
 * the app never verifies it. With `chunk`, the content is a constructed OCTET STRING in pieces.
 */
export function signed(content: Uint8Array, chunk?: number): Uint8Array {
  const octets = chunk
    ? der(
        0x24,
        ...Array.from({ length: Math.ceil(content.length / chunk) }, (_, i) =>
          der(0x04, content.subarray(i * chunk, (i + 1) * chunk)),
        ),
      )
    : der(0x04, content);
  const signerInfo = der(
    0x30,
    der(0x02, Uint8Array.of(1)),
    der(0x04, new Uint8Array(64).fill(0x5a)),
  );
  return der(
    0x30,
    der(0x06, OID_SIGNED_DATA),
    der(
      0xa0,
      der(
        0x30,
        der(0x02, Uint8Array.of(1)),
        der(0x31),
        der(0x30, der(0x06, OID_DATA), der(0xa0, octets)),
        der(0x31, signerInfo),
      ),
    ),
  );
}

function santander(): Page[] {
  const top = (shift: number): Page => [
    { x: 181.1, y: 827.7 + shift, size: 9, str: 'Holder:' },
    { x: 215, y: 827.7 + shift, size: 9, str: 'Jane Example' },
    { x: 181.1, y: 816.4 + shift, size: 9, str: 'Account:' },
    { x: 221.6, y: 816.4 + shift, size: 9, str: 'ES00 0000 0000 0000 0000 0000' },
    { x: 181.1, y: 805.2 + shift, size: 9, str: 'Available balance:' },
    { x: 258.7, y: 805.2 + shift, size: 9, str: '1.234,56€ (on 17 Oct 2026)' },
    { x: 7.5, y: 769.9 + shift, size: 9.7, str: 'Your account activity' },
    { x: 9.4, y: 743.7 + shift, size: 9, str: 'Transaction date' },
    { x: 125.8, y: 743.7 + shift, size: 9, str: 'Transaction' },
    { x: 461.4, y: 743.7 + shift, size: 9, str: 'Amount' },
    { x: 554.1, y: 743.7 + shift, size: 9, str: 'Balance' },
  ];
  const row = (
    y: number,
    date: string,
    value: string,
    lines: string[],
    amount: string,
    balance: string,
  ) => [
    { x: 9.4, y, size: 9, str: date },
    { x: 9.4, y: y - 10.5, size: 7.5, str: `Value date: ${value}` },
    ...lines.map((str, i) => ({ x: i === 0 ? 125.8 : 125.4, y: y - 12 * i, size: 9, str })),
    right(493.3, y, 9, amount),
    right(586.5, y, 9, balance),
  ];
  const footer = (y: number, page: number): Page => [
    { x: 6, y, size: 9, str: 'Document on: 17 Oct 2026' },
    { x: 529.1, y, size: 9, str: `Page ${page} of 2` },
  ];
  return [
    [
      ...top(0),
      ...row(
        727.9,
        '16 Oct 2026',
        '16 Oct 2026',
        ['Compra Panaderia Sol, Madrid, Tarjeta', '0000000000000000 , Comision 0,00'],
        '-3,40€',
        '1.234,56€',
      ),
      ...row(
        697.9,
        '15 Oct 2026',
        '14 Oct 2026',
        ['Transferencia Inmediata De Acme Iberia S.L.'],
        '1.500,00€',
        '1.237,96€',
      ),
      ...row(
        667.9,
        '30 Sept 2026',
        '30 Sept 2026',
        ['Recibo Agua Clara S.A, Concepto: Factura', '000000000000 De Fecha 30/09/2026'],
        '-25,10€',
        '-262,04€',
      ),
      ...footer(121.2, 1),
    ],
    [
      ...top(6),
      ...row(
        733.9,
        '29 Sept 2026',
        '29 Sept 2026',
        ['Compra Libreria Mar, Madrid, Tarjeta'],
        '-12,50€',
        '-236,94€',
      ),
      ...row(
        703.9,
        '1 Sept 2026',
        '31 Aug 2026',
        ['Recibo Gimnasio Norte S.L.'],
        '-35,00€',
        '-224,44€',
      ),
      {
        x: 140.7,
        y: 661.4,
        size: 9,
        str: 'For generic searches, only the 50 most recent transactions are listed by default',
      },
      ...footer(422.7, 2),
    ],
  ];
}

const MONO_COLUMNS = [59.5, 137, 201, 245, 299, 346, 387, 432, 479, 534];

function monobank(language: 'uk' | 'en'): Page[] {
  const uk = language === 'uk';
  const size = uk ? 9 : 8;
  const header = (y: number): Page =>
    (uk
      ? [
          ['Дата i час', 'операції'],
          ['Деталі операції'],
          ['MCC'],
          ['Сума в', 'валюті', 'картки', '(UAH)'],
          ['Сума в', 'валюті', 'операції'],
          ['Валюта'],
          ['Курс'],
          ['Сума', 'комісій', '(UAH)'],
          ['Сума', 'кешбеку/', 'миль'],
          ['Залишок', 'після', 'операції'],
        ]
      : [
          ['Date and time'],
          ['Description'],
          ['MCC'],
          ['Card', 'currency', 'amount,', '(UAH)'],
          ['Operation', 'amount'],
          ['Operation', 'currency'],
          ['Exchange', 'rate'],
          ['Commission,', '(UAH)'],
          ['Cashback', 'amount,', '(UAH)'],
          ['Balance'],
        ]
    ).flatMap((labels, column) =>
      labels.map((str, i) =>
        center(MONO_COLUMNS[column]!, y + (labels.length - 1) * 5.4 - i * 10.8, size, str),
      ),
    );
  const row = (y: number, date: string, time: string, details: string[], cells: string[]): Page => [
    center(MONO_COLUMNS[0]!, y, 9, date),
    center(MONO_COLUMNS[0]!, y - 10.8, 9, time),
    ...details.map((str, i) => center(MONO_COLUMNS[1]!, y - 10.8 * i, 9, str)),
    ...cells.map((str, i) => center(MONO_COLUMNS[i + 2]!, y, 9, str)),
  ];
  const label = (y: number, name: string, value: string): Page => [
    { x: 28.3, y, size: 9, str: name },
    { x: 28.3 + width(name, 9) + 3, y, size: 9, str: value },
  ];
  return [
    [
      { x: 220.5, y: 815.3, size: 7, str: uk ? 'АТ «ПРИКЛАД БАНК»' : 'JSC EXAMPLE BANK' },
      {
        x: 28.3,
        y: 752.8,
        size: 10,
        str: uk ? 'Рух коштів по картці від 17.10.2026р.' : 'Card statement of 17.10.2026',
      },
      ...label(726.1, uk ? 'Клієнт:' : 'Client:', uk ? 'Петренко Іван Іванович' : 'Petrenko Ivan'),
      ...label(699.1, uk ? 'ІПН:' : 'Tax ID:', '0000000000'),
      ...label(603.3, uk ? 'Інформація по картці:' : 'Card:', '4000 **** **** 0000'),
      ...label(589.8, uk ? 'Рахунок:' : 'Account:', 'UA000000000000000000000000000'),
      ...label(
        452.7,
        uk ? 'Сума зарахувань за період:' : 'Amount of charges for the period:',
        '1 000.00 UAH',
      ),
      ...header(401.4),
      ...row(
        368.6,
        '16.10.2026',
        '18:42:05',
        ['Сільпо'],
        ['5411', '-245.90', '-245.90', 'UAH', '—', '0.00', '2.46', '754.10'],
      ),
      ...row(
        341.1,
        '15.10.2026',
        '09:15:00',
        ['Від: Коваленко', 'Олена Петрівна'],
        ['4829', '1 000.00', '1 000.00', 'UAH', '—', '0.00', '0.00', '1 000.00'],
      ),
    ],
    [
      ...header(797.4),
      ...row(
        765,
        '14.10.2026',
        '21:03:44',
        ['Netflix'],
        ['4899', '-1 250.00', '-25.00', 'EUR', '50.00', '0.00', '0.00', '0.00'],
      ),
      ...row(
        737.5,
        '13.10.2026',
        '07:30:12',
        ['Переказ на картку'],
        ['4829', '-500.00', '-500.00', 'UAH', '—', '5.00', '0.00', '1 250.00'],
      ),
      { x: 65.9, y: 624, size: 9, str: uk ? 'Операційний директор' : 'Chief Operating Officer' },
      { x: 441.1, y: 624, size: 9, str: 'Приклад П.П.' },
      {
        x: 28.3,
        y: 529,
        size: 8,
        str: uk ? 'Документ підписано електронним підписом' : 'Signed electronically',
      },
    ],
  ];
}

const UKRSIB_HEADER = (y: number, withCode: boolean, settled = true): Page => [
  { x: 47.6, y, size: 9, str: 'Дата' },
  ...(settled ? [{ x: 104.3, y, size: 9, str: 'Дата' }] : []),
  ...(withCode ? [{ x: settled ? 162.6 : 105.9, y, size: 9, str: 'Код' }] : []),
  { x: withCode ? 277.8 : 249.4, y, size: 9, str: 'Опис операції' },
  { x: 443.1, y, size: 9, str: 'Операція' },
  { x: 511.2, y, size: 9, str: 'Сума в валюті' },
  { x: 40.9, y: y - 14.2, size: 9, str: 'операції' },
  ...(settled ? [{ x: 91.5, y: y - 14.2, size: 9, str: 'розрахунку' }] : []),
  ...(withCode ? [{ x: settled ? 148.4 : 91.8, y: y - 14.2, size: 9, str: 'авторизації' }] : []),
  { x: 417.8, y: y - 14.2, size: 9, str: 'Валюта' },
  { x: 471.8, y: y - 14.2, size: 9, str: 'Сума' },
  { x: 523, y: y - 14.2, size: 9, str: 'рахунку' },
];

/** One positioned item per word, as UkrSib writes descriptions. */
const words = (x: number, y: number, size: number, text: string): Page => {
  const out: Page = [];
  for (const word of text.split(' ')) {
    out.push({ x, y, size, str: word });
    x += width(word, size) + 8;
  }
  return out;
};

function ukrsib(): Page[] {
  const title = (y: number, str: string): Text => center(297.5, y, 10, str);
  const account = (
    y: number,
    date: string,
    parts: string[][],
    amount: string,
    total: string | null,
  ) => {
    const lines: Page = [];
    let at = y;
    parts.forEach((part, index) => {
      if (index > 0) {
        at -= 24;
        lines.push({ x: 141.8, y: at, size: 10, str: '_ '.repeat(27).trim() });
      }
      part.forEach((text, i) => {
        if (index > 0 || i > 0) at -= 12;
        lines.push(...words(141.8, at, 10, text));
      });
    });
    return [
      { x: 36.5, y, size: 9, str: date },
      { x: 93.2, y, size: 9, str: date },
      ...lines,
      { x: 422.6, y, size: 9, str: 'UAH' },
      right(508, y, 9, amount),
      ...(total === null ? [] : [right(565, y, 9, total)]),
    ];
  };
  const card = (
    y: number,
    date: string,
    code: string,
    lines: string[],
    currency: string,
    amount: string,
    total: string,
  ) => [
    { x: 36.5, y, size: 9, str: date },
    { x: 93.2, y, size: 9, str: date },
    { x: 156.6, y, size: 9, str: code },
    ...lines.map((str, i) => ({ x: i === 0 ? 206.3 : 204.1, y: y - 12 * i, size: 9, str })),
    { x: 422.6, y, size: 9, str: currency },
    right(508, y, 9, amount),
    right(565, y, 9, total),
  ];
  return [
    [
      { x: 28.4, y: 801.5, size: 10, str: 'Петренко Іван Іванович' },
      title(777.5, 'Виписка за картковим рахунком клієнта'),
      { x: 34.9, y: 699.2, size: 10, str: 'Номер рахунку' },
      { x: 482.1, y: 699.2, size: 10, str: '00000000000000' },
      title(490.2, 'Операції за картковим рахунком'),
      ...UKRSIB_HEADER(475.7, false),
      ...account(
        447.2,
        '16.10.2026',
        [
          ['Оплата послуг за допомогою інтернет-банкінгу'],
          ['Оплата послуг компанії Приклад-Нет (ТОВ', '"ПРИКЛАД")'],
        ],
        '-250.00',
        '-250.00',
      ),
      ...account(
        360.7,
        '15.10.2026',
        [['Зарахування миттєвого переказу'], ['Повернення боргу']],
        '3 000.00',
        '3 000.00',
      ),
      ...account(290.2, '14.10.2026', [['Виникнення заборгованості за Договором']], '-12.00', null),
      ...account(
        55.2,
        '13.10.2026',
        [['Заробітна плата та аванси від ТОВ "ПРИКЛАД']],
        '20 000.00',
        '20 000.00',
      ),
    ],
    [
      title(801.5, 'Операції за картковим рахунком'),
      ...UKRSIB_HEADER(787, false),
      ...words(141.8, 722.5, 10, 'СОФТ"'),
      ...account(708, '12.10.2026', [['Комісія за переказ']], '-5.00', '-5.00'),
      title(640, 'Операції за платіжними картками'),
      ...UKRSIB_HEADER(625.5, true),
      { x: 28.4, y: 597.1, size: 9, str: 'MASTERCARD STANDARD 535100****0000 PETRENKO IVAN' },
      ...card(
        582.8,
        '11.10.2026',
        '123456',
        ['Оплата товарів\\послуг\\\\ES\\Madrid\\Cafe Sol', 'TX01 : Google Pay ****0000.'],
        'EUR',
        '-4.50',
        '-195.30',
      ),
      ...card(
        556.3,
        '10.10.2026',
        '654321',
        ['Оплата', 'товарів\\послуг\\00000000\\UA\\KYIV\\SHOP', 'TX02 : Google Pay ****0000.'],
        'UAH',
        '-80.00',
        '-80.00',
      ),
      { x: 277.8, y: 518, size: 9, str: 'Разом по картці 535100****0000' },
      right(565, 518, 9, '-275.30'),
      title(470, 'Поточні блокування по рахунку'),
      ...UKRSIB_HEADER(455.5, true, false),
      { x: 28.4, y: 427.1, size: 9, str: 'MASTERCARD STANDARD 535100****0000 PETRENKO IVAN' },
      { x: 36.5, y: 412.8, size: 9, str: '17.10.2026' },
      { x: 99.9, y: 412.8, size: 9, str: '777777' },
      { x: 149.7, y: 412.8, size: 9, str: 'Оплата товарів\\послуг - утримання' },
      { x: 423.3, y: 412.8, size: 9, str: 'EUR' },
      right(508, 412.8, 9, '-10.00'),
      right(565, 412.8, 9, '-434.00'),
    ],
  ];
}

if (import.meta.main) {
  const write = (name: string, bytes: Uint8Array) =>
    writeFileSync(new URL(name, import.meta.url), bytes);
  write('santander.pdf', pdf(santander()));
  write('monobank-uk.pdf', signed(pdf(monobank('uk'))));
  write('monobank-en.pdf', signed(pdf(monobank('en'))));
  write('ukrsib.pdf', pdf(ukrsib()));
  write('scanned.pdf', pdf([[]], '0.9 g 50 50 495 742 re f\n'));
}
