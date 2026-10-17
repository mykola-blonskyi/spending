import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeLocalData, localRow, syncedState } from '@data/sync/fixtures';
import { groupByDay, type HistoryItem, toEntryRow } from '../history-model';
import { HISTORY_STORAGE_KEY } from '../history-view';
import { renderTransactionScreen } from '../test-helpers';
import { HistoryList } from './history-list';

const ROW = 60;

function history(count: number): HistoryItem[] {
  const day = (index: number) =>
    `2026-${String(1 + Math.floor(index / 300)).padStart(2, '0')}-${String(1 + (Math.floor(index / 10) % 28)).padStart(2, '0')}`;
  const rows = Array.from({ length: count }, (_, index) =>
    toEntryRow(
      {
        ...localRow({ id: `tx-${index}`, occurredOn: day(index) }),
        scope: 'personal',
        version: null,
        author: null,
        baseAmountMinor: 1250,
        fx: null,
        sync: { state: 'synced' },
      },
      {
        categories: new Map(),
        accounts: new Map(),
        dayLabel: String,
        uncategorized: '',
        transfer: '',
        outside: '',
      },
    ),
  );
  return groupByDay(
    rows.sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1)),
    String,
  );
}

beforeEach(() => {
  localStorage.clear();
  // jsdom lays nothing out; every element reports one row's height.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ width: 400, height: ROW }),
  );
});
afterEach(() => vi.restoreAllMocks());

describe('HistoryList', () => {
  it.each(['window', 'self'] as const)(
    'keeps the DOM bounded for 5,000 entries (%s scroll)',
    (scroll) => {
      const items = history(5000);
      const first = items.find((item) => item.type === 'entry')!.key;
      expect(items.length).toBeGreaterThan(5000);
      render(
        <div style={{ height: 600 }}>
          <HistoryList
            items={items}
            scroll={scroll}
            label="Transactions"
            selectedId={first}
            renderDay={(day) => <h2>{day.label}</h2>}
            renderEntry={(row, position, selected) => (
              <a href={row.href} aria-current={selected || undefined} data-position={position}>
                {row.id}
              </a>
            )}
          />
        </div>,
      );
      const list = screen.getByRole('list', { name: 'Transactions' });
      const rendered = list.querySelectorAll('li').length;
      expect(rendered).toBeGreaterThan(0);
      expect(rendered).toBeLessThan(60);
      expect(screen.getAllByRole('link')[0]).toHaveAttribute('aria-current', 'true');
    },
  );

  it.each(['window', 'self'] as const)(
    'keeps the DOM bounded for 5,000 entries in the table (%s scroll)',
    (scroll) => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ width: 1200, height: ROW }),
      );
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ view: 'table' }));
      renderTransactionScreen(
        <div style={{ height: 600 }}>
          <HistoryList
            items={history(5000)}
            scroll={scroll}
            label="Transactions"
            renderDay={() => null}
            renderEntry={() => null}
          />
        </div>,
        { data: fakeLocalData(syncedState()).value, path: '/transactions', route: '/transactions' },
      );
      const table = screen.getByRole('table', { name: 'Transactions' });
      expect(table).toHaveAttribute('aria-rowcount', '5001');
      const rendered = table.querySelectorAll('[role="row"][aria-rowindex]').length;
      expect(rendered).toBeGreaterThan(1);
      expect(rendered).toBeLessThan(60);
    },
  );
});
