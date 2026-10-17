import { Tag } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import type { Account, TransactionEntry } from '@data/sync';
import { localRow } from '@data/sync/fixtures';
import type { CategoryView } from '@features/ledger';
import {
  activeFilters,
  clearFilter,
  dayNets,
  EMPTY_FILTERS,
  DEFAULT_TABLE_SORT,
  groupByDay,
  nextSort,
  type RowContext,
  sortTableRows,
  summarize,
  tableColumns,
  toEntryRow,
  toHistoryRows,
  toQuery,
  toTableRows,
  transferCandidates,
} from './history-model';

const groceries: CategoryView = {
  id: 'cat-groceries',
  workspaceId: 'ws-personal',
  kind: 'expense',
  name: 'Groceries',
  color: '#16a34a',
  Icon: Tag,
  archived: false,
};
const card = { id: 'acc-card', name: 'Card' } as Account;
const savings = { id: 'acc-savings', name: 'Savings' } as Account;

const context: RowContext = {
  categories: new Map([[groceries.id, groceries]]),
  accounts: new Map([
    [card.id, card],
    [savings.id, savings],
  ]),
  dayLabel: (date) => `day ${date}`,
  uncategorized: 'Uncategorized',
  transfer: 'Transfer',
  outside: 'Own account outside the app',
};

function entry(patch: Partial<TransactionEntry> = {}): TransactionEntry {
  return {
    ...localRow(),
    scope: 'personal',
    version: null,
    author: null,
    baseAmountMinor: 1250,
    fx: null,
    sync: { state: 'synced' },
    ...patch,
  };
}

describe('toQuery', () => {
  it('drops every filter left at "any"', () => {
    expect(toQuery(EMPTY_FILTERS)).toEqual({});
    expect(toQuery({ ...EMPTY_FILTERS, text: '   ' })).toEqual({});
  });

  it('passes set filters through', () => {
    expect(
      toQuery({
        text: 'cof',
        kind: 'income',
        from: '2026-10-01',
        to: '2026-10-31',
        categoryId: 'c',
        accountId: 'a',
        currency: 'USD',
      }),
    ).toEqual({
      text: 'cof',
      kind: 'income',
      from: '2026-10-01',
      to: '2026-10-31',
      categoryId: 'c',
      accountId: 'a',
      currency: 'USD',
    });
  });
});

describe('activeFilters', () => {
  it('lists chip filters only, the period once', () => {
    const filters = {
      ...EMPTY_FILTERS,
      text: 'x',
      kind: 'expense',
      from: '2026-10-01',
      to: '2026-10-02',
      currency: 'EUR',
    } as const;
    expect(activeFilters(filters)).toEqual(['period', 'currency']);
    expect(clearFilter(filters, 'period')).toMatchObject({ from: '', to: '', currency: 'EUR' });
    expect(clearFilter(filters, 'currency').currency).toBe('');
  });
});

describe('toEntryRow', () => {
  it('names the row by description, category and account', () => {
    const row = toEntryRow(entry({ categoryId: groceries.id, accountId: card.id }), context);
    expect(row).toMatchObject({
      href: '/transactions/tx-1',
      title: 'Coffee',
      subtitle: 'Groceries · Card',
      category: groceries,
      accountName: 'Card',
      dateLabel: 'day 2026-10-14',
    });
  });

  it('falls back to the category, then to "Uncategorized", without repeating it', () => {
    expect(toEntryRow(entry({ description: '', categoryId: groceries.id }), context)).toMatchObject(
      {
        title: 'Groceries',
        subtitle: '',
      },
    );
    expect(toEntryRow(entry({ description: '', accountId: card.id }), context)).toMatchObject({
      title: 'Uncategorized',
      subtitle: 'Card',
      category: undefined,
    });
  });
});

const row = (id: string, occurredOn: string, patch: Partial<TransactionEntry> = {}) =>
  toEntryRow(entry({ id, occurredOn, ...patch }), context);

const fx = { rate: '1.0850', rateDate: '2026-10-14', source: 'ecb' };
const usd = { currency: 'USD', amountMinor: 1085, baseAmountMinor: 1000, fx };
const chf = { currency: 'CHF', amountMinor: 500, baseAmountMinor: null, fx: null, version: 1 };

describe('conversion', () => {
  it('is same for EUR, converted with a rate, unavailable without one', () => {
    expect(row('a', '2026-10-14').conversion).toEqual({ state: 'same' });
    expect(row('b', '2026-10-14', usd).conversion).toEqual({
      state: 'converted',
      baseAmountMinor: 1000,
      fx,
    });
    expect(row('c', '2026-10-14', chf).conversion).toEqual({ state: 'unavailable' });
  });

  it('is pending, and counted apart from EUR, until the server converts an unsent entry', () => {
    const unsent = row('d', '2026-10-14', { ...chf, version: null, sync: { state: 'pending' } });
    expect(unsent.conversion).toEqual({ state: 'pending' });
    expect(summarize([unsent])).toEqual({
      base: { expense: 0, income: 0 },
      unconverted: [{ currency: 'CHF', expense: 500, income: 0 }],
    });
  });

  it('is pending for a rejected entry the server never converted', () => {
    const rejected = { state: 'failed', code: 'VALIDATION_FAILED' } as const;
    expect(row('e', '2026-10-14', { ...chf, version: null, sync: rejected }).conversion).toEqual({
      state: 'pending',
    });
  });
});

describe('summarize', () => {
  it('sums EUR and converted amounts in EUR and lists unconverted ones per currency', () => {
    expect(
      summarize([
        row('a', '2026-10-14', { amountMinor: 250 }),
        row('b', '2026-10-14', { kind: 'income', amountMinor: 3000 }),
        row('c', '2026-10-14', usd),
        row('d', '2026-10-14', chf),
        row('e', '2026-10-14', { ...chf, kind: 'income', amountMinor: 70 }),
        row('f', '2026-10-14', { ...chf, currency: 'AUD' }),
      ]),
    ).toEqual({
      base: { expense: 1250, income: 3000 },
      unconverted: [
        { currency: 'AUD', expense: 500, income: 0 },
        { currency: 'CHF', expense: 500, income: 70 },
      ],
    });
  });
});

describe('transfers (BR-37)', () => {
  it('names a transfer instead of "Uncategorized" and leaves it out of the totals', () => {
    const side = toEntryRow(
      entry({ description: '', accountId: card.id, transferId: 'tr-1' }),
      context,
    );
    expect(side).toMatchObject({ title: 'Transfer', subtitle: 'Card', transfer: { view: 'side' } });
    expect(toEntryRow(entry({ transferId: 'tr-1' }), context).subtitle).toBe('Transfer');
    expect(summarize([side, toEntryRow(entry({ amountMinor: 300 }), context)]).base).toEqual({
      expense: 300,
      income: 0,
    });
  });

  describe('history rows', () => {
    const out = entry({
      id: 'out',
      accountId: card.id,
      amountMinor: 5000,
      transferId: 'tr-1',
      description: 'To savings',
    });
    const into = entry({
      id: 'in',
      kind: 'income',
      accountId: savings.id,
      amountMinor: 4990,
      currency: 'UAH',
      transferId: 'tr-1',
      occurredOn: '2026-10-15',
      sync: { state: 'pending' },
    });
    const plain = entry({ id: 'plain', occurredOn: '2026-10-13' });

    it('shows both sides as one row where the newer side sorts, outside the totals', () => {
      const rows = toHistoryRows([into, out, plain], context, true);
      expect(rows.map((row) => row.id)).toEqual(['out', 'plain']);
      expect(rows[0]).toMatchObject({
        title: 'Card → Savings',
        subtitle: 'Transfer · To savings',
        amountMinor: 5000,
        currency: 'EUR',
        occurredOn: '2026-10-15',
        sync: { state: 'pending' },
        transfer: { view: 'whole', into: { amountMinor: 4990, currency: 'UAH' } },
      });
      expect(summarize(rows).base).toEqual({ expense: 1250, income: 0 });
      expect(groupByDay(rows, context.dayLabel).map((item) => item.key)).toEqual([
        'day-2026-10-15',
        'out',
        'day-2026-10-13',
        'plain',
      ]);
    });

    it('shows each side with an account filter', () => {
      const rows = toHistoryRows([into, out], context, false);
      expect(rows.map((row) => [row.id, row.transfer])).toEqual([
        ['in', { view: 'side' }],
        ['out', { view: 'side' }],
      ]);
    });

    it('names an own account outside the app for a one-sided transfer', () => {
      const outside = { ...into, transferOutside: true };
      expect(toHistoryRows([outside], context, true)[0]).toMatchObject({
        title: 'Own account outside the app → Savings',
        transfer: { view: 'whole', into: null },
      });
    });

    it('keeps a side whose partner is not here as a side row', () => {
      expect(toHistoryRows([out], context, true)[0]).toMatchObject({
        id: 'out',
        title: 'To savings',
        transfer: { view: 'side' },
      });
    });
  });

  it('offers the other sides on another account of the same space, nearest first', () => {
    const out = entry({ id: 'out', accountId: 'card', amountMinor: 5000 });
    const other = (id: string, patch: Partial<TransactionEntry>) =>
      entry({ id, kind: 'income', accountId: 'savings', amountMinor: 5000, ...patch });
    const candidates = transferCandidates(out, [
      out,
      other('far', { occurredOn: '2026-09-01' }),
      other('close', { amountMinor: 4900 }),
      other('exact', {}),
      other('same-account', { accountId: 'card' }),
      other('same-kind', { kind: 'expense' }),
      other('family', { workspaceId: 'ws-family' }),
      other('linked', { transferId: 'tr-9' }),
    ]);
    expect(candidates.map((c) => c.id)).toEqual(['exact', 'close', 'far']);
  });
});

describe('the history table', () => {
  const labels = { uncategorized: 'Uncategorized', transfer: 'Transfer' };
  const out = entry({
    id: 'out',
    accountId: card.id,
    transferId: 'tr-1',
    description: '',
    occurredOn: '2026-10-15',
  });
  const into = entry({
    id: 'in',
    kind: 'income',
    accountId: savings.id,
    transferId: 'tr-1',
    description: 'From card',
    occurredOn: '2026-10-15',
  });
  const bread = entry({
    id: 'bread',
    description: 'Bread',
    categoryId: groceries.id,
    accountId: card.id,
    occurredOn: '2026-10-14',
  });
  const bare = entry({ id: 'bare', description: '', occurredOn: '2026-10-13' });
  const table = (combine: boolean) =>
    toTableRows(
      groupByDay(toHistoryRows([out, into, bread, bare], context, combine), context.dayLabel),
      labels,
    ).map(({ row, ...cells }) => ({ id: row.id, ...cells }));

  it('shows "who" only to a family member', () => {
    expect(tableColumns(false)).toEqual([
      'date',
      'description',
      'category',
      'account',
      'amount',
      'sync',
    ]);
    expect(tableColumns(true)).toEqual([
      'date',
      'description',
      'category',
      'account',
      'amount',
      'who',
      'sync',
    ]);
  });

  it('lists the rows newest first, without day headers, a transfer as one row', () => {
    expect(table(true)).toEqual([
      {
        id: 'out',
        date: 'day 2026-10-15',
        description: 'From card',
        category: 'Transfer',
        account: 'Card → Savings',
      },
      {
        id: 'bread',
        date: 'day 2026-10-14',
        description: 'Bread',
        category: 'Groceries',
        account: 'Card',
      },
      {
        id: 'bare',
        date: 'day 2026-10-13',
        description: '',
        category: 'Uncategorized',
        account: '',
      },
    ]);
  });

  it("shows each side's own account with an account filter", () => {
    expect(table(false).slice(0, 2)).toEqual([
      { id: 'out', date: 'day 2026-10-15', description: '', category: 'Transfer', account: 'Card' },
      {
        id: 'in',
        date: 'day 2026-10-15',
        description: 'From card',
        category: 'Transfer',
        account: 'Savings',
      },
    ]);
  });
});

describe('sorting the history table', () => {
  const labels = { uncategorized: 'Uncategorized', transfer: 'Transfer' };
  // Newest first, as the history holds them: "late" and "early" share a day.
  const entries = [
    entry({ id: 'late', occurredOn: '2026-10-15', amountMinor: 300, baseAmountMinor: 300 }),
    entry({ id: 'early', occurredOn: '2026-10-15', amountMinor: 900, baseAmountMinor: 900 }),
    entry({ id: 'usd', occurredOn: '2026-10-14', ...usd }),
    entry({ id: 'chf', occurredOn: '2026-10-13', ...chf }),
    entry({ id: 'income', kind: 'income', occurredOn: '2026-10-12', amountMinor: 300 }),
    entry({ id: 'unsent', occurredOn: '2026-10-11', ...chf, version: null }),
  ];
  const rows = toTableRows(
    groupByDay(toHistoryRows(entries, context, true), context.dayLabel),
    labels,
  );
  const sorted = (column: 'date' | 'amount', direction: 'asc' | 'desc') =>
    sortTableRows(rows, { column, direction }, 'en').map(({ row }) => row.id);

  it('is newest first by default, the order the history holds', () => {
    expect(sortTableRows(rows, DEFAULT_TABLE_SORT, 'en')).toEqual(rows);
  });

  it('by date oldest first is the exact reverse, ties included', () => {
    expect(sorted('date', 'asc')).toEqual(['unsent', 'income', 'chf', 'usd', 'early', 'late']);
  });

  it('by amount uses the EUR amount, unconverted entries last in both directions', () => {
    expect(sorted('amount', 'desc')).toEqual(['usd', 'early', 'late', 'income', 'chf', 'unsent']);
    expect(sorted('amount', 'asc')).toEqual(['late', 'income', 'early', 'usd', 'chf', 'unsent']);
  });

  it('breaks ties newest first in both directions', () => {
    const ties = ['late', 'income'];
    expect(sorted('amount', 'desc').filter((id) => ties.includes(id))).toEqual(ties);
    expect(sorted('amount', 'asc').filter((id) => ties.includes(id))).toEqual(ties);
  });

  it('flips the active column and starts another in its first direction', () => {
    expect(nextSort(DEFAULT_TABLE_SORT, 'date')).toEqual({ column: 'date', direction: 'asc' });
    expect(nextSort(DEFAULT_TABLE_SORT, 'amount')).toEqual({ column: 'amount', direction: 'desc' });
    expect(nextSort({ column: 'amount', direction: 'desc' }, 'amount')).toEqual({
      column: 'amount',
      direction: 'asc',
    });
  });
});

describe('dayNets', () => {
  it('nets EUR first when the day has any, then each unconverted currency', () => {
    expect(dayNets(summarize([row('a', '2026-10-14', usd), row('b', '2026-10-14', chf)]))).toEqual([
      { currency: 'EUR', net: -1000 },
      { currency: 'CHF', net: -500 },
    ]);
    expect(dayNets(summarize([row('a', '2026-10-14', chf)]))).toEqual([
      { currency: 'CHF', net: -500 },
    ]);
  });
});

describe('groupByDay', () => {
  it('puts a header before each day and marks where rows sit in it', () => {
    const items = groupByDay(
      [
        row('a', '2026-10-14'),
        row('b', '2026-10-14'),
        row('c', '2026-10-14'),
        row('d', '2026-10-13'),
        row('e', '2026-10-12', { kind: 'income', amountMinor: 500 }),
        row('f', '2026-10-12', { ...chf, currency: 'USD', amountMinor: 300 }),
      ],
      (date) => `label ${date}`,
    );
    expect(
      items.map((item) => (item.type === 'day' ? item.date : `${item.key}:${item.position}`)),
    ).toEqual([
      '2026-10-14',
      'a:first',
      'b:middle',
      'c:last',
      '2026-10-13',
      'd:only',
      '2026-10-12',
      'e:first',
      'f:last',
    ]);
    expect(items[0]).toMatchObject({
      key: 'day-2026-10-14',
      label: 'label 2026-10-14',
      count: 3,
      totals: { base: { expense: 3750, income: 0 }, unconverted: [] },
    });
    expect(items[6]).toMatchObject({
      totals: {
        base: { expense: 0, income: 500 },
        unconverted: [{ currency: 'USD', expense: 300, income: 0 }],
      },
    });
  });

  it('is empty for no rows', () => {
    expect(groupByDay([], String)).toEqual([]);
  });
});
