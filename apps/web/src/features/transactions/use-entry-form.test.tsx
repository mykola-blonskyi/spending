import { act, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testSession } from '@data/testing';
import {
  localRow,
  page,
  PERSONAL,
  sequentialIds,
  serverRow,
  syncedState,
} from '@data/sync/fixtures';
import { reducePull } from '@data/sync/pull';
import { reducePush } from '@data/sync/push';
import { applyLocalChange } from '@data/sync/queue';
import { emptyLocalState, type LocalState, queueOrder } from '@data/sync/model';
import { account, category, fakeLocalData, renderTransactionHook } from './test-helpers';
import { useEntryForm } from './use-entry-form';

vi.mock('@features/auth', () => ({ useSession: () => testSession() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const NOW = '2026-10-15T00:00:00.000Z';
const salary = category({ id: 'cat-salary', name: 'Salary', kind: 'income', systemKey: 'salary' });
const usd = account({ id: 'acc-usd', name: 'Dollars', currency: 'USD' });

function ledger(state: LocalState): LocalState {
  return {
    ...state,
    accounts: new Map([usd, account()].map((a) => [a.id, a])),
    categories: new Map([category(), salary].map((c) => [c.id, c])),
  };
}

function setup(path: string, state = ledger(syncedState())) {
  const data = fakeLocalData(state);
  const route = path === '/transactions/new' ? path : '/transactions/:id';
  return {
    data,
    ...renderTransactionHook(() => useEntryForm(), { data: data.value, path, route }),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('useEntryForm', () => {
  it('starts a new expense today in the personal workspace', () => {
    const { result } = setup('/transactions/new');
    expect(result.current).toMatchObject({ status: 'ready', mode: 'new', canDelete: false });
    expect(result.current.values).toMatchObject({ kind: 'expense', amount: '', currency: 'EUR' });
    expect(result.current.categories.map((c) => c.name)).toEqual(['Groceries']);
  });

  it('drops a category of the other kind and adopts the account currency', () => {
    const { result } = setup('/transactions/new');
    act(() => result.current.set('categoryId', 'cat-groceries'));
    act(() => result.current.setKind('income'));
    expect(result.current.values.categoryId).toBeNull();
    expect(result.current.categories.map((c) => c.name)).toEqual(['Salary']);
    act(() => result.current.set('categoryId', 'cat-salary'));
    act(() => result.current.setKind('income'));
    expect(result.current.values.categoryId).toBe('cat-salary');

    act(() => result.current.setAccount('acc-usd'));
    expect(result.current.values).toMatchObject({ accountId: 'acc-usd', currency: 'USD' });
    act(() => result.current.setAccount(null));
    expect(result.current.values).toMatchObject({ accountId: null, currency: 'USD' });
  });

  it('shows the amount error only after a save attempt, then writes once and returns', async () => {
    const { result, data, location } = setup('/transactions/new');
    expect(result.current.errors).toEqual({});
    await act(() => result.current.submit());
    expect(result.current.errors).toEqual({ amount: 'invalid' });
    expect(data.store.commit).not.toHaveBeenCalled();

    for (const key of ['1', '2', 'separator', '5'] as const)
      act(() => result.current.amount.press(key));
    expect(result.current.amount.display).toBe('12.5');
    act(() => result.current.set('description', ' Coffee '));
    await act(() => result.current.submit());

    expect(data.store.commit).toHaveBeenCalledTimes(1);
    const [mutation] = queueOrder(data.current());
    expect(mutation?.change).toMatchObject({
      type: 'transaction.upsert',
      transaction: { amountMinor: 1250, description: 'Coffee', workspaceId: PERSONAL.id },
    });
    expect(location()).toBe('/transactions');
  });

  it('edits a stored entry and deletes it after leaving for history', async () => {
    const { result, data, location } = setup(
      '/transactions/tx-1',
      ledger(syncedState(serverRow({ note: 'oat milk' }))),
    );
    expect(result.current).toMatchObject({ status: 'ready', mode: 'edit', canDelete: true });
    expect(result.current.values).toMatchObject({ amount: '12.50', note: 'oat milk' });

    act(() => result.current.set('amount', '20'));
    await act(() => result.current.submit());
    expect(queueOrder(data.current())[0]?.change).toMatchObject({
      transaction: { id: 'tx-1', amountMinor: 2000, note: 'oat milk' },
    });
    expect(location()).toBe('/transactions');
  });

  it('bases a save on the version editing started from, so a row pulled meanwhile conflicts', async () => {
    const { result, data } = setup(
      '/transactions/tx-1',
      ledger(syncedState(serverRow({ version: 3 }))),
    );
    act(() => result.current.set('amount', '20'));
    await act(() =>
      data.store.commit(
        (state) =>
          reducePull(state, page({ transactions: [serverRow({ version: 4, note: 'Bob' })] }), NOW)
            .state,
      ),
    );
    await act(() => result.current.submit());
    expect(queueOrder(data.current())).toMatchObject([{ baseVersion: 3 }]);
  });

  it('bases a save started on a pending entry on the version that change became', async () => {
    const pending = applyLocalChange(
      ledger(syncedState(serverRow({ version: 3 }))),
      { type: 'upsert', row: localRow({ note: 'mine' }) },
      sequentialIds(),
    );
    const { result, data } = setup('/transactions/tx-1', pending);
    act(() => result.current.set('amount', '20'));
    await act(() =>
      data.store.commit((state) =>
        reducePush(
          state,
          [{ mutationId: 'm-1', status: 'applied', transaction: serverRow({ version: 4 }) }],
          NOW,
          ['m-1'],
        ),
      ),
    );
    await act(() =>
      data.store.commit(
        (state) =>
          reducePull(state, page({ transactions: [serverRow({ version: 5, note: 'Bob' })] }), NOW)
            .state,
      ),
    );
    await act(() => result.current.submit());
    expect(queueOrder(data.current())).toMatchObject([{ baseVersion: 4 }]);
  });

  it('shows the stored conversion only while amount, currency and date are unchanged', () => {
    const fx = { rate: '1.0850', rateDate: '2026-10-14', source: 'ecb' };
    const { result } = setup(
      '/transactions/tx-1',
      ledger(syncedState(serverRow({ currency: 'USD', baseAmountMinor: 1000, fx }))),
    );
    expect(result.current.conversion).not.toBeNull();
    act(() => result.current.set('occurredOn', '2026-10-01'));
    expect(result.current.conversion).toBeNull();
  });

  it('removes through the queue and toasts when the device cannot write', async () => {
    const { result, data, location } = setup(
      '/transactions/tx-1',
      ledger(syncedState(serverRow())),
    );
    data.store.commit.mockRejectedValueOnce(new Error('disk full'));
    await act(() => result.current.remove());
    expect(location()).toBe('/transactions');
    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  });

  it('reports a missing entry and an unopened store', () => {
    expect(setup('/transactions/nope').result.current.status).toBe('notFound');
    expect(setup('/transactions/new', emptyLocalState()).result.current.status).toBe('loading');
  });
});
