import { describe, expect, it } from 'vitest';
import { type CurrencyCode, parseCurrency } from '../../common/money';
import { convert, rateWindow, UNCONVERTED } from './conversion';
import { parseEcbXml } from './ecb';

const c = (code: string) => parseCurrency(code) as CurrencyCode;

const feed = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>${body}</Cube>
</gesmes:Envelope>`;

describe('parseEcbXml', () => {
  it('reads days and rates with either quote style', () => {
    const xml = feed(`
      <Cube time='2026-10-14'>
        <Cube currency='USD' rate='1.0823'/>
        <Cube currency="JPY" rate="162.50" />
      </Cube>
      <Cube time="2026-10-13"><Cube currency='USD' rate='1.08'/></Cube>`);
    expect(parseEcbXml(xml)).toEqual([
      { date: '2026-10-14', currency: 'USD', ratePerEur: '1.0823' },
      { date: '2026-10-14', currency: 'JPY', ratePerEur: '162.50' },
      { date: '2026-10-13', currency: 'USD', ratePerEur: '1.08' },
    ]);
  });

  it('skips currencies the runtime does not know', () => {
    const xml = feed(
      `<Cube time='2026-10-14'><Cube currency='USD' rate='1.1'/><Cube currency='ZZZ' rate='2'/></Cube>`,
    );
    expect(parseEcbXml(xml).map((r) => r.currency)).toEqual(['USD']);
  });

  it.each([
    ['a rate outside a day', `<Cube currency='USD' rate='1.1'/>`],
    ['an impossible date', `<Cube time='2026-02-30'><Cube currency='USD' rate='1.1'/></Cube>`],
    ['a negative rate', `<Cube time='2026-10-14'><Cube currency='USD' rate='-1.1'/></Cube>`],
    ['a zero rate', `<Cube time='2026-10-14'><Cube currency='USD' rate='0.000'/></Cube>`],
    ['an exponent', `<Cube time='2026-10-14'><Cube currency='USD' rate='1e3'/></Cube>`],
    [
      'too many digits',
      `<Cube time='2026-10-14'><Cube currency='USD' rate='1.12345678901'/></Cube>`,
    ],
    ['a missing rate', `<Cube time='2026-10-14'><Cube currency='USD'/></Cube>`],
    ['no rates at all', ''],
  ])('rejects %s', (_name, body) => {
    expect(() => parseEcbXml(feed(body))).toThrow();
  });

  it('rejects input that is not the feed', () => {
    expect(() => parseEcbXml('<html>maintenance</html>')).toThrow();
  });
});

describe('rateWindow', () => {
  it('looks back seven days, inclusive', () => {
    expect(rateWindow('2026-10-14')).toEqual({ from: '2026-10-07', to: '2026-10-14' });
    expect(rateWindow('2024-03-02')).toEqual({ from: '2024-02-24', to: '2024-03-02' });
  });
});

describe('convert', () => {
  const quote = { date: '2026-10-13', ratePerEur: '1.0823000000', source: 'ecb' };

  it('keeps EUR as is without a rate', () => {
    expect(convert(1250, c('EUR'), quote)).toEqual({ ...UNCONVERTED, baseAmountMinor: 1250 });
  });

  it('converts with a quote and records it', () => {
    expect(convert(10_823, c('USD'), quote)).toEqual({
      baseAmountMinor: 10_000,
      fxRate: '1.0823000000',
      fxRateDate: '2026-10-13',
      fxSource: 'ecb',
    });
  });

  it('stays unconverted without a quote or when the result overflows', () => {
    expect(convert(100, c('USD'), null)).toEqual(UNCONVERTED);
    expect(convert(Number.MAX_SAFE_INTEGER, c('JPY'), { ...quote, ratePerEur: '0.0001' })).toEqual(
      UNCONVERTED,
    );
  });
});
