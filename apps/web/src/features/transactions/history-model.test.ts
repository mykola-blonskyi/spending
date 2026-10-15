import { Tag } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import type { Account, TransactionEntry } from '@data/sync';
import { localRow } from '@data/sync/fixtures';
import type { CategoryView } from '@features/ledger';
import {
  activeFilters,
  clearFilter,
  EMPTY_FILTERS,
  groupByDay,
  type RowContext,
  summarize,
  toEntryRow,
  toQuery,
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

const context: RowContext = {
  categories: new Map([[groceries.id, groceries]]),
  accounts: new Map([[card.id, card]]),
  dayLabel: (date) => `day ${date}`,
  uncategorized: 'Uncategorized',
};

function entry(patch: Partial<TransactionEntry> = {}): TransactionEntry {
  return {
    ...localRow(),
    scope: 'personal',
    baseAmountMinor: 1250,
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

describe('summarize', () => {
  it('sums each currency on its own', () => {
    expect(
      summarize([
        { kind: 'expense', amountMinor: 100, currency: 'USD' },
        { kind: 'expense', amountMinor: 250, currency: 'EUR' },
        { kind: 'income', amountMinor: 1000, currency: 'EUR' },
        { kind: 'expense', amountMinor: 5, currency: 'USD' },
      ]),
    ).toEqual([
      { currency: 'EUR', expense: 250, income: 1000 },
      { currency: 'USD', expense: 105, income: 0 },
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
        row('f', '2026-10-12', { currency: 'USD', amountMinor: 300 }),
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
      totals: [{ currency: 'EUR', expense: 3750, income: 0 }],
    });
    expect(items[6]).toMatchObject({
      totals: [
        { currency: 'EUR', expense: 0, income: 500 },
        { currency: 'USD', expense: 300, income: 0 },
      ],
    });
  });

  it('is empty for no rows', () => {
    expect(groupByDay([], String)).toEqual([]);
  });
});
