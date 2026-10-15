import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testSession } from '@data/testing';
import { serverRow, syncedState } from '@data/sync/fixtures';
import type { LocalData } from '@data/sync/local-data-context';
import { emptyLocalState, type LocalState } from '@data/sync/model';
import { account, category, fakeLocalData, renderTransactionHook } from './test-helpers';
import { useHistory } from './use-history';

vi.mock('@features/auth', () => ({ useSession: () => testSession() }));

const render = (data: LocalData, path = '/transactions') =>
  renderTransactionHook(useHistory, { data, path, route: '/transactions/:id?' });

function withLedger(state: LocalState): LocalState {
  return {
    ...state,
    accounts: new Map([[account().id, account()]]),
    categories: new Map([[category().id, category()]]),
  };
}

beforeEach(() => vi.useRealTimers());

describe('useHistory', () => {
  it('tells loading, unavailable, first sync, empty and no matches apart', () => {
    expect(render({ status: 'opening' }).result.current.status).toBe('loading');
    expect(render({ status: 'unavailable' }).result.current.status).toBe('unavailable');
    expect(render(fakeLocalData(emptyLocalState()).value).result.current.status).toBe('firstSync');

    const empty = render(fakeLocalData(syncedState()).value);
    expect(empty.result.current.status).toBe('empty');
    act(() => empty.result.current.setFilter('kind', 'income'));
    expect(empty.result.current.status).toBe('noMatches');
  });

  it('groups matching rows by day and totals them per currency', () => {
    const data = fakeLocalData(
      withLedger(
        syncedState(
          serverRow({ id: 'a', occurredOn: '2026-10-14', categoryId: 'cat-groceries' }),
          serverRow({ id: 'b', occurredOn: '2026-10-13', currency: 'USD', amountMinor: 300 }),
          serverRow({ id: 'c', occurredOn: '2026-10-13', kind: 'income', amountMinor: 900 }),
        ),
      ),
    );
    const { result } = render(data.value, '/transactions/b');
    const { items, totals, status, selectedId } = result.current;
    expect(status).toBe('ready');
    expect(selectedId).toBe('b');
    expect(items.map((item) => item.key)).toEqual([
      'day-2026-10-14',
      'a',
      'day-2026-10-13',
      'c',
      'b',
    ]);
    expect(totals).toEqual([
      { currency: 'EUR', expense: 1250, income: 900 },
      { currency: 'USD', expense: 300, income: 0 },
    ]);
    expect(result.current.options.currencies).toEqual(['EUR', 'USD']);
  });

  it('turns filters into a query and chips that clear themselves', async () => {
    const data = fakeLocalData(
      withLedger(
        syncedState(
          serverRow({ id: 'a', description: 'Coffee', categoryId: 'cat-groceries' }),
          serverRow({ id: 'b', description: 'Bus', occurredOn: '2026-09-01' }),
        ),
      ),
    );
    const { result } = render(data.value);
    const keys = () => result.current.items.filter((i) => i.type === 'entry').map((i) => i.key);

    act(() => result.current.setFilter('categoryId', 'cat-groceries'));
    expect(keys()).toEqual(['a']);
    expect(result.current.chips.map((chip) => chip.label)).toEqual(['Groceries']);

    act(() => result.current.chips[0]!.clear());
    expect(keys()).toEqual(['a', 'b']);

    act(() => {
      result.current.setFilter('from', '2026-09-01');
      result.current.setFilter('to', '2026-09-30');
    });
    expect(keys()).toEqual(['b']);
    expect(result.current.chips.map((chip) => chip.label)).toEqual([
      'From Sep 1, 2026 to Sep 30, 2026',
    ]);

    act(() => result.current.setFilter('text', 'bus'));
    await waitFor(() => expect(keys()).toEqual(['b']));
    act(() => result.current.reset());
    expect(result.current.filters).toMatchObject({ text: 'bus', from: '', to: '', kind: 'all' });
    await waitFor(() => expect(keys()).toEqual(['b']));
    act(() => result.current.setFilter('text', 'nothing like it'));
    await waitFor(() => expect(result.current.status).toBe('noMatches'));
  });
});
