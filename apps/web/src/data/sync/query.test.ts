import { describe, expect, it } from 'vitest';
import type { EngineStatus } from './engine';
import { localRow, page, sequentialIds, serverRow, syncedState } from './fixtures';
import { emptyLocalState, type LocalState } from './model';
import { reducePull } from './pull';
import { applyLocalChange, setMutationState } from './queue';
import { queryTransactions, totalsByCurrency } from './query';
import { deriveSyncStatus } from './status';

const history = syncedState(
  serverRow({ id: 'a', occurredOn: '2026-10-01', description: 'Rent', amountMinor: 90000 }),
  serverRow({ id: 'b', occurredOn: '2026-10-14', description: 'Coffee beans', note: 'Market' }),
  serverRow({
    id: 'c',
    occurredOn: '2026-10-14',
    kind: 'income',
    description: 'Salary',
    currency: 'USD',
    createdAt: '2026-10-14T12:00:00.000Z',
  }),
);

const ids = (state: LocalState, filter = {}) => queryTransactions(state, filter).map((e) => e.id);

describe('queryTransactions', () => {
  it('sorts newest first by date, then by creation', () => {
    expect(ids(history)).toEqual(['c', 'b', 'a']);
  });

  it('filters by text in description or note, ignoring case', () => {
    expect(ids(history, { text: 'coffee' })).toEqual(['b']);
    expect(ids(history, { text: 'MARKET' })).toEqual(['b']);
  });

  it('filters by kind, currency and period', () => {
    expect(ids(history, { kind: 'income' })).toEqual(['c']);
    expect(ids(history, { currency: 'EUR' })).toEqual(['b', 'a']);
    expect(ids(history, { from: '2026-10-02', to: '2026-10-14' })).toEqual(['c', 'b']);
  });

  it('shows the overlay instead of the server row and hides a pending delete', () => {
    let state = applyLocalChange(
      history,
      { type: 'upsert', row: localRow({ id: 'a', occurredOn: '2026-10-01', amountMinor: 5 }) },
      sequentialIds(),
    );
    state = applyLocalChange(state, { type: 'delete', id: 'b' }, sequentialIds('d'));
    expect(queryTransactions(state, {}).map((e) => [e.id, e.amountMinor, e.sync.state])).toEqual([
      ['c', 1250, 'synced'],
      ['a', 5, 'pending'],
    ]);
  });
});

describe('totalsByCurrency', () => {
  it('counts an entry with a pending edit once, at its local amount', () => {
    const state = applyLocalChange(
      syncedState(serverRow({ amountMinor: 1000 })),
      { type: 'upsert', row: localRow({ amountMinor: 400 }) },
      sequentialIds(),
    );
    expect(totalsByCurrency(queryTransactions(state, {})).get('EUR')).toEqual({
      income: 0,
      expense: 400,
    });
  });
});

describe('deriveSyncStatus', () => {
  const idle: EngineStatus = { phase: 'idle' };
  const pending = applyLocalChange(
    syncedState(),
    { type: 'upsert', row: localRow() },
    sequentialIds(),
  );
  const failed = setMutationState(pending, ['m-1'], { status: 'failed', code: 'X', message: '' });
  const conflicted = reducePull(
    failed,
    page({
      conflicts: [
        {
          id: 'c',
          transactionId: 'tx-1',
          baseVersion: 1,
          serverVersion: 2,
          local: { deleted: true },
          server: serverRow(),
          createdAt: '',
        },
      ],
    }),
    '',
  ).state;

  it.each<[string, EngineStatus, LocalState, boolean, ReturnType<typeof deriveSyncStatus>]>([
    ['synced', idle, emptyLocalState(), true, { state: 'synced' }],
    ['pending', idle, pending, true, { state: 'pending', count: 1 }],
    ['syncing', { phase: 'syncing' }, pending, true, { state: 'syncing' }],
    ['retrying', { phase: 'retrying' }, pending, true, { state: 'retrying' }],
    ['offline over syncing', { phase: 'syncing' }, pending, false, { state: 'offline', count: 1 }],
    ['failed over offline', idle, failed, false, { state: 'failed', count: 1 }],
    ['conflict over failed', idle, conflicted, true, { state: 'conflict', count: 1 }],
    ['auth over all', { phase: 'authRequired' }, conflicted, true, { state: 'authRequired' }],
  ])('%s', (_, engine, state, online, expected) => {
    expect(deriveSyncStatus(engine, state, online)).toEqual(expected);
  });
});
