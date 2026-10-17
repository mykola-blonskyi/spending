import { describe, expect, it } from 'vitest';
import { BASE_CURRENCY, type CurrencyCode, parseCurrency } from '../common/money';
import type { RateQuote } from '../ledger/fx/conversion';
import { type MatchRow, type RateLookup, suggestTransfers } from './transfer-match';

const row = (id: string, extra: Partial<MatchRow> = {}): MatchRow => ({
  id,
  kind: 'expense',
  amountMinor: 50_000,
  currency: BASE_CURRENCY,
  occurredOn: '2026-10-10',
  accountId: 'card',
  description: 'Payment',
  ...extra,
});
const income = (id: string, extra: Partial<MatchRow> = {}) =>
  row(id, { kind: 'income', accountId: 'savings', ...extra });

const UAH = parseCurrency('UAH') as CurrencyCode;
const noRates: RateLookup = () => null;
/** 45 UAH per EUR on 2026-10-10 only. */
const uahRate: RateLookup = (currency: CurrencyCode, date: string): RateQuote | null =>
  currency === 'UAH' && date === '2026-10-10' ? { date, ratePerEur: '45', source: 'ECB' } : null;

describe('suggestTransfers', () => {
  it.each([
    ['uk', 'Переказ на свій рахунок 4149'],
    ['uk', 'ЗІ СВОЄЇ КАРТКИ *0001'],
    ['ru', 'Перевод на свою карту'],
    ['ru', 'Перевод на свой счёт'],
    ['en', 'Transfer to own account'],
    ['es', 'TRASPASO A CUENTA 0049'],
    ['es', 'Movimiento entre cuentas'],
  ])('suggests a one-sided transfer for a %s phrase: %s', (_, description) => {
    expect(suggestTransfers([row('a', { description })], [], '', noRates)).toEqual([
      { transactionId: 'a', counterpartId: null, reason: 'keyword' },
    ]);
  });

  it('suggests a row naming the user, in any word order, but not a one-word name', () => {
    const imported = [
      row('a', { description: 'Переказ: КОВАЛЕНКО ОЛЕНА' }),
      row('b', { description: 'Olena at the market' }),
    ];
    expect(suggestTransfers(imported, [], 'Олена Коваленко', noRates)).toEqual([
      { transactionId: 'a', counterpartId: null, reason: 'keyword' },
    ]);
    expect(suggestTransfers(imported, [], 'Olena', noRates)).toEqual([]);
  });

  it('leaves ordinary rows alone', () => {
    expect(suggestTransfers([row('a', { description: 'Mercadona' })], [], '', noRates)).toEqual([]);
  });

  it('pairs the same amount in the same currency on another account', () => {
    expect(
      suggestTransfers(
        [row('a')],
        [income('b', { amountMinor: 49_999 }), income('c')],
        '',
        noRates,
      ),
    ).toEqual([{ transactionId: 'a', counterpartId: 'c', reason: 'counterpart' }]);
  });

  it('prefers a counterpart over a keyword', () => {
    const imported = [row('a', { description: 'На свій рахунок' })];
    expect(suggestTransfers(imported, [income('b')], '', noRates)).toEqual([
      { transactionId: 'a', counterpartId: 'b', reason: 'counterpart' },
    ]);
  });

  it('pairs across currencies within 3% at the rate of the imported row date', () => {
    // 500 EUR is 22 500 UAH at 45; 3% of it is 675 UAH.
    const at = (amountMinor: number) =>
      suggestTransfers(
        [row('a')],
        [income('b', { currency: UAH, amountMinor, occurredOn: '2026-10-11' })],
        '',
        uahRate,
      );
    expect(at(2_182_500)).toEqual([
      { transactionId: 'a', counterpartId: 'b', reason: 'counterpart' },
    ]);
    expect(at(2_317_500)).toHaveLength(1);
    expect(at(2_182_400)).toEqual([]);
    expect(at(2_317_600)).toEqual([]);
  });

  it('pairs no currencies without a rate', () => {
    expect(
      suggestTransfers(
        [row('a', { occurredOn: '2026-10-12' })],
        [income('b', { currency: UAH, amountMinor: 2_250_000, occurredOn: '2026-10-12' })],
        '',
        uahRate,
      ),
    ).toEqual([]);
  });

  it('matches within 3 days either way, not 4', () => {
    const near = (occurredOn: string) =>
      suggestTransfers([row('a')], [income('b', { occurredOn })], '', noRates);
    expect(near('2026-10-13')).toHaveLength(1);
    expect(near('2026-10-07')).toHaveLength(1);
    expect(near('2026-10-14')).toEqual([]);
    expect(near('2026-10-06')).toEqual([]);
  });

  it('uses each candidate once, the nearest date first', () => {
    const imported = [row('far', { occurredOn: '2026-10-08' }), row('near')];
    expect(
      suggestTransfers(imported, [income('b', { occurredOn: '2026-10-11' })], '', noRates),
    ).toEqual([{ transactionId: 'near', counterpartId: 'b', reason: 'counterpart' }]);
  });

  it('prefers the nearer amount on the same day across currencies', () => {
    const uah = (id: string, amountMinor: number) =>
      income(id, { currency: UAH, amountMinor, occurredOn: '2026-10-10' });
    expect(
      suggestTransfers([row('a')], [uah('far', 2_200_000), uah('near', 2_240_000)], '', uahRate),
    ).toEqual([{ transactionId: 'a', counterpartId: 'near', reason: 'counterpart' }]);
  });

  it('never pairs the same kind or the same account', () => {
    const candidates = [
      row('same-kind', { accountId: 'savings' }),
      income('same-account', { accountId: 'card' }),
    ];
    expect(suggestTransfers([row('a')], candidates, '', noRates)).toEqual([]);
  });
});
