import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localRow } from '@data/sync/fixtures';
import { groupByDay, type HistoryItem, toEntryRow } from '../history-model';
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
      { categories: new Map(), accounts: new Map(), dayLabel: String, uncategorized: '' },
    ),
  );
  return groupByDay(
    rows.sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1)),
    String,
  );
}

beforeEach(() => {
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
});
