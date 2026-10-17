import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '@shared/components';
import type { EngineStatus } from './engine';
import { localRow, page, sequentialIds, serverRow, syncedState } from './fixtures';
import { emptyLocalState, type LocalState } from './model';
import { reducePull } from './pull';
import { applyLocalChange, setMutationState } from './queue';
import { accountBalance, openingForBalance, queryTransactions } from './query';
import { deriveSyncStatus, smoothingDelay } from './status';

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

  it('shows the server row of a rejected delete as failed, so it can be discarded', () => {
    const deleted = applyLocalChange(history, { type: 'delete', id: 'b' }, sequentialIds());
    const rejected = setMutationState(deleted, ['m-1'], {
      status: 'failed',
      code: 'FORBIDDEN',
      message: '',
    });
    const entry = queryTransactions(rejected, {}).find((e) => e.id === 'b');
    expect([entry?.description, entry?.version, entry?.sync]).toEqual([
      'Coffee beans',
      1,
      { state: 'failed', code: 'FORBIDDEN' },
    ]);
  });
});

describe('localEntries conversion', () => {
  const fx = { rate: '1.0850', rateDate: '2026-10-14', source: 'ecb' };
  const usd = serverRow({ currency: 'USD', amountMinor: 1085, baseAmountMinor: 1000, fx });
  const conversion = (state: LocalState) =>
    queryTransactions(state, {}).map((e) => [e.baseAmountMinor, e.fx]);

  it('takes the EUR amount and rate from the server row', () => {
    expect(conversion(syncedState(usd))).toEqual([[1000, fx]]);
  });

  it('keeps them while a pending edit leaves amount and currency unchanged', () => {
    const edited = applyLocalChange(
      syncedState(usd),
      { type: 'upsert', row: localRow({ currency: 'USD', amountMinor: 1085, note: 'Tip' }) },
      sequentialIds(),
    );
    expect(conversion(edited)).toEqual([[1000, fx]]);
  });

  it('drops them while a pending edit changes the amount, currency or date', () => {
    const changed = (patch: Parameters<typeof localRow>[0]) =>
      conversion(
        applyLocalChange(
          syncedState(usd),
          { type: 'upsert', row: localRow(patch) },
          sequentialIds(),
        ),
      );
    expect(changed({ currency: 'USD', amountMinor: 2000 })).toEqual([[null, null]]);
    expect(changed({ currency: 'GBP', amountMinor: 1085 })).toEqual([[null, null]]);
    expect(changed({ currency: 'EUR', amountMinor: 1085 })).toEqual([[1085, null]]);
    expect(changed({ currency: 'USD', amountMinor: 1085, occurredOn: '2026-10-01' })).toEqual([
      [null, null],
    ]);
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
    ['synced', idle, syncedState(), true, { state: 'synced' }],
    ['first pull not finished', idle, emptyLocalState(), true, { state: 'syncing' }],
    ['offline before first pull', idle, emptyLocalState(), false, { state: 'offline', count: 0 }],
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

describe('smoothingDelay', () => {
  const synced = { state: 'synced' } as const;
  const syncing = { state: 'syncing' } as const;
  const pending = { state: 'pending', count: 1 } as const;
  const offline = { state: 'offline', count: 1 } as const;

  it.each<[string, SyncStatus, SyncStatus, number, number]>([
    ['syncing waits 300 ms', syncing, pending, 5000, 300],
    ['a count change shows at once', { state: 'pending', count: 2 }, pending, 0, 0],
    ['a pending change replaces synced at once', pending, synced, 100, 0],
    ['going offline replaces synced at once', offline, synced, 100, 0],
    ['synced holds 600 ms against syncing', syncing, synced, 0, 600],
    ['after the hold, the next state shows at once', offline, synced, 700, 0],
    ['leaving syncing is immediate', synced, syncing, 0, 0],
  ])('%s', (_, next, shown, shownFor, expected) => {
    expect(smoothingDelay(next, shown, shownFor)).toBe(expected);
  });
});

describe('accountBalance (BR-40)', () => {
  const savings: Parameters<typeof accountBalance>[0] = {
    id: 'acc-savings',
    openingBalanceMinor: 100000,
    openingOn: '2026-10-01',
  };
  const on = (patch: Parameters<typeof serverRow>[0]) =>
    serverRow({ accountId: savings.id, amountMinor: 1000, occurredOn: '2026-10-10', ...patch });
  const balanceOf = (state: LocalState, account = savings) =>
    accountBalance(account, state.transactions.values());

  it('adds income and subtracts expenses to the opening balance, other accounts ignored', () => {
    const state = syncedState(
      on({ id: 'a', kind: 'income', amountMinor: 20000 }),
      on({ id: 'b', kind: 'expense', amountMinor: 5000 }),
      serverRow({ id: 'c', accountId: 'acc-card', amountMinor: 999 }),
    );
    expect(balanceOf(state)).toEqual({ balanceMinor: 115000, uncounted: 0, entries: 2 });
  });

  it('counts transfer sides in and out, and rows awaiting review', () => {
    const state = syncedState(
      on({ id: 'in', kind: 'income', amountMinor: 30000, transferId: 'tr-1' }),
      on({
        id: 'out',
        kind: 'expense',
        amountMinor: 10000,
        transferOutside: true,
        transferId: 'tr-2',
      }),
      on({ id: 'review', kind: 'expense', amountMinor: 2000, reviewStatus: 'pending_review' }),
    );
    expect(balanceOf(state)).toEqual({ balanceMinor: 118000, uncounted: 0, entries: 3 });
  });

  it('leaves entries before the opening date out and reports how many', () => {
    const state = syncedState(
      on({ id: 'old', occurredOn: '2026-09-30', amountMinor: 7000 }),
      on({ id: 'first', occurredOn: '2026-10-01', amountMinor: 1000 }),
    );
    expect(balanceOf(state)).toEqual({ balanceMinor: 99000, uncounted: 1, entries: 2 });
  });

  it('counts every entry when the account has no opening date', () => {
    const state = syncedState(on({ id: 'old', occurredOn: '2020-01-01', amountMinor: 7000 }));
    expect(balanceOf(state, { ...savings, openingBalanceMinor: 0, openingOn: null })).toEqual({
      balanceMinor: -7000,
      uncounted: 0,
      entries: 1,
    });
  });

  it('goes negative from a negative opening balance', () => {
    const state = syncedState(on({ id: 'a', amountMinor: 500 }));
    expect(balanceOf(state, { ...savings, openingBalanceMinor: -2000 }).balanceMinor).toBe(-2500);
  });

  it('counts a pending edit instead of the server row and ignores a pending delete', () => {
    let state = syncedState(on({ id: 'a', amountMinor: 1000 }), on({ id: 'b', amountMinor: 3000 }));
    state = applyLocalChange(
      state,
      { type: 'upsert', row: localRow({ id: 'a', accountId: savings.id, amountMinor: 4000 }) },
      sequentialIds(),
    );
    state = applyLocalChange(state, { type: 'delete', id: 'b' }, sequentialIds('d'));
    expect(balanceOf(state).balanceMinor).toBe(96000);
  });
});

describe('openingForBalance (BR-40)', () => {
  const account = { id: 'acc-savings', openingOn: null as string | null };
  const entry = (patch: Parameters<typeof serverRow>[0]) =>
    serverRow({ accountId: account.id, amountMinor: 1000, occurredOn: '2026-10-10', ...patch });
  const opening = (state: LocalState, target: number, on = account.openingOn) =>
    openingForBalance(
      { ...account, openingOn: on },
      state.transactions.values(),
      target,
      '2026-10-18',
    );

  it('keeps the existing opening date and ignores older entries', () => {
    const state = syncedState(
      entry({ id: 'old', occurredOn: '2026-09-01', amountMinor: 9999 }),
      entry({ id: 'in', kind: 'income', amountMinor: 20000 }),
      entry({ id: 'out', amountMinor: 5000 }),
    );
    expect(opening(state, 175000, '2026-10-01')).toEqual({
      openingBalanceMinor: 160000,
      openingOn: '2026-10-01',
    });
  });

  it('starts at the earliest live entry without an opening date', () => {
    const state = syncedState(
      entry({ id: 'a', occurredOn: '2026-10-12', amountMinor: 3000 }),
      entry({ id: 'b', occurredOn: '2026-10-05', amountMinor: 1000 }),
      serverRow({ id: 'other', accountId: 'acc-card', occurredOn: '2026-01-01' }),
    );
    expect(opening(state, 10000)).toEqual({ openingBalanceMinor: 14000, openingOn: '2026-10-05' });
  });

  it('starts today when the account has no entries', () => {
    expect(opening(syncedState(), 50000)).toEqual({
      openingBalanceMinor: 50000,
      openingOn: '2026-10-18',
    });
  });

  it('clears the date when the opening balance comes out 0', () => {
    const state = syncedState(entry({ id: 'in', kind: 'income', amountMinor: 20000 }));
    expect(opening(state, 20000, '2026-10-01')).toEqual({
      openingBalanceMinor: 0,
      openingOn: null,
    });
  });

  it('takes a negative target', () => {
    expect(opening(syncedState(), -12000)).toEqual({
      openingBalanceMinor: -12000,
      openingOn: '2026-10-18',
    });
  });
});
