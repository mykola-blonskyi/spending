import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pdf, signed } from '../../../e2e/fixtures/pdf-fixtures';
import { PDF_MAX_PAGES, readPdf, unwrapSignedPdf } from './pdf';

const fixture = (name: string) => new Uint8Array(readFileSync(`e2e/fixtures/${name}`));
const parse = async (name: string) => {
  const result = await readPdf(fixture(name));
  if ('problem' in result) throw new Error(result.problem);
  const [header, ...rows] = result.map((row) => row.cells);
  return { headers: header, rows };
};

describe('readPdf', () => {
  it('reads Santander: right-aligned amounts, wrapped descriptions, value dates, two pages', async () => {
    expect(await parse('santander.pdf')).toEqual({
      headers: ['Transaction date', 'Transaction', 'Amount', 'Balance', 'Value date'],
      rows: [
        [
          '16 Oct 2026',
          'Compra Panaderia Sol, Madrid, Tarjeta 0000000000000000 , Comision 0,00',
          '-3,40€',
          '1.234,56€',
          '16 Oct 2026',
        ],
        [
          '15 Oct 2026',
          'Transferencia Inmediata De Acme Iberia S.L.',
          '1.500,00€',
          '1.237,96€',
          '14 Oct 2026',
        ],
        [
          '30 Sept 2026',
          'Recibo Agua Clara S.A, Concepto: Factura 000000000000 De Fecha 30/09/2026',
          '-25,10€',
          '-262,04€',
          '30 Sept 2026',
        ],
        [
          '29 Sept 2026',
          'Compra Libreria Mar, Madrid, Tarjeta',
          '-12,50€',
          '-236,94€',
          '29 Sept 2026',
        ],
        ['1 Sept 2026', 'Recibo Gimnasio Norte S.L.', '-35,00€', '-224,44€', '31 Aug 2026'],
      ],
    });
  });

  it('unwraps a signed monobank PDF and joins its stacked headers and centred cells', async () => {
    const rows = [
      [
        '16.10.2026 18:42:05',
        'Сільпо',
        '5411',
        '-245.90',
        '-245.90',
        'UAH',
        '—',
        '0.00',
        '2.46',
        '754.10',
      ],
      [
        '15.10.2026 09:15:00',
        'Від: Коваленко Олена Петрівна',
        '4829',
        '1 000.00',
        '1 000.00',
        'UAH',
        '—',
        '0.00',
        '0.00',
        '1 000.00',
      ],
      [
        '14.10.2026 21:03:44',
        'Netflix',
        '4899',
        '-1 250.00',
        '-25.00',
        'EUR',
        '50.00',
        '0.00',
        '0.00',
        '0.00',
      ],
      [
        '13.10.2026 07:30:12',
        'Переказ на картку',
        '4829',
        '-500.00',
        '-500.00',
        'UAH',
        '—',
        '5.00',
        '0.00',
        '1 250.00',
      ],
    ];
    expect(await parse('monobank-uk.pdf')).toEqual({
      headers: [
        'Дата i час операції',
        'Деталі операції',
        'MCC',
        'Сума в валюті картки (UAH)',
        'Сума в валюті операції',
        'Валюта',
        'Курс',
        'Сума комісій (UAH)',
        'Сума кешбеку/ миль',
        'Залишок після операції',
      ],
      rows,
    });
    expect(await parse('monobank-en.pdf')).toEqual({
      headers: [
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
      ],
      rows,
    });
  });

  it('reads UkrSib: grouped header, separators, page breaks, card table, no totals or holds', async () => {
    expect(await parse('ukrsib.pdf')).toEqual({
      headers: [
        'Дата операції',
        'Дата розрахунку',
        'Опис операції',
        'Операція Валюта',
        'Операція Сума',
        'Сума в валюті рахунку',
        'Код авторизації',
      ],
      rows: [
        [
          '16.10.2026',
          '16.10.2026',
          'Оплата послуг за допомогою інтернет-банкінгу · Оплата послуг компанії Приклад-Нет (ТОВ "ПРИКЛАД")',
          'UAH',
          '-250.00',
          '-250.00',
          '',
        ],
        [
          '15.10.2026',
          '15.10.2026',
          'Зарахування миттєвого переказу · Повернення боргу',
          'UAH',
          '3 000.00',
          '3 000.00',
          '',
        ],
        [
          '14.10.2026',
          '14.10.2026',
          'Виникнення заборгованості за Договором',
          'UAH',
          '-12.00',
          '',
          '',
        ],
        [
          '13.10.2026',
          '13.10.2026',
          'Заробітна плата та аванси від ТОВ "ПРИКЛАД СОФТ"',
          'UAH',
          '20 000.00',
          '20 000.00',
          '',
        ],
        ['12.10.2026', '12.10.2026', 'Комісія за переказ', 'UAH', '-5.00', '-5.00', ''],
        [
          '11.10.2026',
          '11.10.2026',
          'Оплата товарів\\послуг\\\\ES\\Madrid\\Cafe Sol TX01 : Google Pay ****0000.',
          'EUR',
          '-4.50',
          '-195.30',
          '123456',
        ],
        [
          '10.10.2026',
          '10.10.2026',
          'Оплата товарів\\послуг\\00000000\\UA\\KYIV\\SHOP TX02 : Google Pay ****0000.',
          'UAH',
          '-80.00',
          '-80.00',
          '654321',
        ],
      ],
    });
  });

  it('numbers the header 0 and transactions from 1 in file order', async () => {
    const result = await readPdf(fixture('santander.pdf'));
    expect('problem' in result || result.map((row) => row.line)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('names the problem for a scan, a broken file and too many pages', async () => {
    expect(await readPdf(fixture('scanned.pdf'))).toEqual({ problem: 'PDF_NO_TEXT' });
    expect(await readPdf(new TextEncoder().encode('%PDF-1.4 broken'))).toEqual({
      problem: 'UNREADABLE',
    });
    expect(await readPdf(Uint8Array.of(0x50, 0x4b, 3, 4))).toEqual({ problem: 'UNREADABLE' });
    const pages = Array.from({ length: PDF_MAX_PAGES + 1 }, () => []);
    expect(await readPdf(pdf(pages))).toEqual({ problem: 'PDF_TOO_MANY_PAGES' });
  });

  it('finds no rows in a text PDF without a statement table', async () => {
    const page = [{ x: 50, y: 700, size: 12, str: 'Dear customer, see you soon.' }];
    expect(await readPdf(pdf([page]))).toEqual([]);
  });
});

describe('unwrapSignedPdf', () => {
  const document = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');

  it('passes a plain PDF through and finds one inside CMS, also when chunked', () => {
    expect(unwrapSignedPdf(document)).toBe(document);
    expect([...unwrapSignedPdf(signed(document))!]).toEqual([...document]);
    expect([...unwrapSignedPdf(signed(document, 4))!]).toEqual([...document]);
  });

  it('rejects other files and truncated or indefinite-length wrappers', () => {
    expect(unwrapSignedPdf(new TextEncoder().encode('Fecha;Importe'))).toBeNull();
    expect(unwrapSignedPdf(signed(document).subarray(0, 20))).toBeNull();
    expect(unwrapSignedPdf(Uint8Array.of(0x30, 0x80, 0x04, 0x02, 0x25, 0x50, 0, 0))).toBeNull();
  });
});
