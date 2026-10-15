import { describe, expect, it } from 'vitest';
import { type CurrencyCode, parseCurrency } from '../../common/money';
import { convert, rateWindow, UNCONVERTED } from './conversion';
import { type FxRate, parseEcbXml } from './ecb';
import { type FxFeed, fetchFeeds, type FxRateSource, readCapped } from './fx-source';

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

  it('rejects a feed cut off inside a tag', () => {
    const whole = feed(`<Cube time='2026-10-14'><Cube currency='USD' rate='1.1'/></Cube>`);
    expect(() => parseEcbXml(whole.slice(0, whole.indexOf("rate='1.1'") + 10))).toThrow(
      'unterminated',
    );
  });

  it('rejects a feed cut off cleanly between tags', () => {
    const whole = feed(
      `<Cube time='2026-10-14'><Cube currency='USD' rate='1.1'/><Cube currency='GBP' rate='0.8'/></Cube>`,
    );
    const cut = whole.slice(0, whole.indexOf("<Cube currency='GBP'"));
    expect(() => parseEcbXml(cut)).toThrow('truncated');
  });

  it('rejects an oversized tag quickly instead of scanning it', () => {
    const started = performance.now();
    expect(() => parseEcbXml(feed(`<Cube ${'a'.repeat(400_000)}>`))).toThrow('oversized');
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('rejects input that is not the feed', () => {
    expect(() => parseEcbXml('<html>maintenance</html>')).toThrow();
  });
});

describe('parseEcbXml on the full history', () => {
  it('reads a feed the size of the full ECB history in one pass', () => {
    const currencies = ['USD', 'JPY', 'GBP', 'CHF', 'SEK', 'NOK', 'PLN', 'CZK', 'HUF', 'DKK'];
    const days = Array.from({ length: 7000 }, (_, i) => {
      const date = new Date(Date.UTC(1999, 0, 4 + i)).toISOString().slice(0, 10);
      const rates = currencies.map((c) => `<Cube currency='${c}' rate='1.2345'/>`).join('');
      return `<Cube time='${date}'>${rates}</Cube>`;
    });
    const xml = feed(days.join('\n'.repeat(3)).repeat(3));
    const started = performance.now();
    expect(parseEcbXml(xml)).toHaveLength(7000 * currencies.length * 3);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe('readCapped', () => {
  it('returns a body within the limit and refuses a larger one', async () => {
    expect(await readCapped(new Response('x'.repeat(100)), 100)).toBe('x'.repeat(100));
    await expect(readCapped(new Response('x'.repeat(101)), 100)).rejects.toThrow('too large');
  });
});

describe('fetchFeeds', () => {
  const rate = (date: string, ratePerEur: string): FxRate => ({
    date,
    currency: 'USD',
    ratePerEur,
  });
  const source = (feeds: Partial<Record<FxFeed, FxRate[]>>): FxRateSource => ({
    name: 'fake',
    fetch: async (feed) => {
      const rates = feeds[feed];
      if (!rates) throw new Error(`${feed} is down`);
      return rates;
    },
  });

  it('keeps the daily feed when the history feed fails', async () => {
    const failures: string[] = [];
    const rates = await fetchFeeds(
      source({ latest: [rate('2026-10-14', '1.1')] }),
      ['history', 'latest'],
      (feed, error) => failures.push(`${feed}: ${(error as Error).message}`),
    );
    expect(rates).toEqual([rate('2026-10-14', '1.1')]);
    expect(failures).toEqual(['history: history is down']);
  });

  it('lets a later feed win for the same day and currency', async () => {
    const rates = await fetchFeeds(
      source({
        history: [rate('2026-10-13', '1.0'), rate('2026-10-14', '1.0')],
        latest: [rate('2026-10-14', '1.1')],
      }),
      ['history', 'latest'],
      () => {},
    );
    expect(rates).toEqual([rate('2026-10-13', '1.0'), rate('2026-10-14', '1.1')]);
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
