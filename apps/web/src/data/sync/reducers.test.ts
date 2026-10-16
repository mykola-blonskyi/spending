import { describe, expect, it } from 'vitest';
import {
  FAMILY,
  localRow,
  page,
  PERSONAL,
  sequentialIds,
  serverRow,
  syncedState,
  tombstone,
} from './fixtures';
import { emptyLocalState, type LocalState, queueOrder } from './model';
import { reducePull, settleConflict } from './pull';
import { discardFailed, reducePush } from './push';
import { applyLocalChange, setMutationState } from './queue';
import { localEntries } from './query';

const now = '2026-10-15T12:00:00.000Z';

function editLocally(state: LocalState, patch: Parameters<typeof localRow>[0]): LocalState {
  return applyLocalChange(state, { type: 'upsert', row: localRow(patch) }, sequentialIds());
}

describe('reducePull', () => {
  it('fills an empty device and marks the first sync complete only on the last page', () => {
    const first = reducePull(
      emptyLocalState(),
      page({ transactions: [serverRow()], cursor: 10, hasMore: true }),
      now,
    );
    expect(first.hasMore).toBe(true);
    expect(first.state.meta).toMatchObject({ cursor: 10, lastSyncedAt: null });

    const last = reducePull(
      first.state,
      page({ transactions: [serverRow({ id: 'tx-2' })], cursor: 12 }),
      now,
    );
    expect(last.hasMore).toBe(false);
    expect(last.state.meta).toMatchObject({ cursor: 12, lastSyncedAt: now });
    expect([...last.state.transactions.keys()].sort()).toEqual(['tx-1', 'tx-2']);
  });

  it('refreshes the server row under a pending overlay and keeps the overlay', () => {
    const state = editLocally(syncedState(serverRow({ version: 1 })), { amountMinor: 999 });
    const { state: next } = reducePull(
      state,
      page({ transactions: [serverRow({ version: 2, amountMinor: 500 })] }),
      now,
    );
    expect(next.transactions.get('tx-1')).toMatchObject({
      server: { version: 2, amountMinor: 500 },
      local: { amountMinor: 999 },
    });
    expect(queueOrder(next)[0]?.baseVersion).toBe(1);
    expect(localEntries(next).map((e) => e.amountMinor)).toEqual([999]);
  });

  it('takes a backfilled conversion (same version, higher revision) without a conflict', () => {
    const unconverted = serverRow({ currency: 'CHF', amountMinor: 500, baseAmountMinor: null });
    const fx = { rate: '0.9400', rateDate: '2026-10-14', source: 'ecb' };
    const { state: next } = reducePull(
      syncedState(unconverted),
      page({ transactions: [{ ...unconverted, revision: 11, baseAmountMinor: 532, fx }] }),
      now,
    );
    expect(next.transactions.get('tx-1')?.server).toMatchObject({ version: 1, revision: 11 });
    expect(localEntries(next)).toMatchObject([
      { baseAmountMinor: 532, fx, sync: { state: 'synced' } },
    ]);
    expect(next.conflicts.size).toBe(0);
  });

  it('removes a row on a tombstone unless a change to it is pending', () => {
    const clean = syncedState(serverRow({ id: 'a' }), serverRow({ id: 'b' }));
    const pending = applyLocalChange(
      clean,
      { type: 'upsert', row: localRow({ id: 'b', amountMinor: 1 }) },
      sequentialIds(),
    );
    const { state } = reducePull(
      pending,
      page({ transactions: [tombstone('a'), tombstone('b')] }),
      now,
    );
    expect([...state.transactions.keys()]).toEqual(['b']);
  });

  it('replaces conflicts with the full open list', () => {
    const conflict = {
      id: 'c-1',
      transactionId: 'tx-1',
      baseVersion: 1,
      serverVersion: 2,
      local: { deleted: true as const },
      server: serverRow({ version: 2 }),
      createdAt: now,
    };
    const withConflict = reducePull(syncedState(), page({ conflicts: [conflict] }), now).state;
    expect([...withConflict.conflicts.keys()]).toEqual(['c-1']);
    expect(reducePull(withConflict, page({ conflicts: [] }), now).state.conflicts.size).toBe(0);
  });

  it("drops a vanished workspace's rows and fails its pending changes with NO_ACCESS (BR-17)", () => {
    const base: LocalState = {
      ...syncedState(
        serverRow({ id: 'mine' }),
        serverRow({ id: 'fam', workspaceId: FAMILY.id, scope: 'family' }),
        serverRow({ id: 'fam-edit', workspaceId: FAMILY.id, scope: 'family' }),
      ),
      workspaces: new Map([
        [PERSONAL.id, PERSONAL],
        [FAMILY.id, FAMILY],
      ]),
    };
    const pending = applyLocalChange(
      base,
      { type: 'upsert', row: localRow({ id: 'fam-edit', workspaceId: FAMILY.id }) },
      sequentialIds(),
    );
    const { state } = reducePull(
      pending,
      page({
        workspaces: [PERSONAL],
        categories: [],
      }),
      now,
    );
    expect([...state.transactions.keys()].sort()).toEqual(['fam-edit', 'mine']);
    expect([...state.workspaces.keys()]).toEqual([PERSONAL.id]);
    expect(localEntries(state).find((entry) => entry.id === 'fam-edit')?.sync).toEqual({
      state: 'failed',
      code: 'NO_ACCESS',
    });

    const again = reducePull(state, page(), now).state;
    expect(again.mutations).toEqual(state.mutations);
    const discarded = reducePull(discardFailed(again, 'fam-edit'), page(), now).state;
    expect([...discarded.transactions.keys()]).toEqual(['mine']);
    expect(discarded.mutations.size).toBe(0);
  });

  it('keeps only the latest pending change of an entry whose workspace vanished', () => {
    const base: LocalState = {
      ...syncedState(serverRow({ id: 'fam', workspaceId: FAMILY.id, scope: 'family' })),
      workspaces: new Map([
        [PERSONAL.id, PERSONAL],
        [FAMILY.id, FAMILY],
      ]),
    };
    const ids = sequentialIds();
    const sending = setMutationState(
      applyLocalChange(
        base,
        { type: 'upsert', row: localRow({ id: 'fam', workspaceId: FAMILY.id, amountMinor: 1 }) },
        ids,
      ),
      ['m-1'],
      { status: 'sending', since: now },
    );
    const twoPending = applyLocalChange(
      sending,
      { type: 'upsert', row: localRow({ id: 'fam', workspaceId: FAMILY.id, amountMinor: 2 }) },
      ids,
    );
    const { state } = reducePull(twoPending, page(), now);
    expect(queueOrder(state)).toMatchObject([
      { mutationId: 'm-2', state: { status: 'failed', code: 'NO_ACCESS' } },
    ]);
    expect(localEntries(state)).toMatchObject([{ id: 'fam', amountMinor: 2 }]);
  });

  it('restarts from cursor 0 when a workspace appears after the first sync', () => {
    const outcome = reducePull(
      syncedState(),
      page({ workspaces: [PERSONAL, FAMILY], cursor: 30, hasMore: false }),
      now,
    );
    expect(outcome.hasMore).toBe(true);
    expect(outcome.state.meta.cursor).toBe(0);
  });

  it('adopts the first epoch it sees without starting over', () => {
    const outcome = reducePull(emptyLocalState(), page({ cursor: 25 }), now);
    expect(outcome.hasMore).toBe(false);
    expect(outcome.state.meta).toMatchObject({ cursor: 25, epoch: 'epoch-1' });
  });

  it('drops server state but keeps unsent changes when the epoch changes (BR-35)', () => {
    const synced: LocalState = {
      ...syncedState(serverRow({ id: 'edited' }), serverRow({ id: 'ghost' })),
      accounts: new Map([['acc-1', { id: 'acc-1' } as never]]),
      categories: new Map([['cat-1', { id: 'cat-1' } as never]]),
    };
    const pending = editLocally(synced, { id: 'edited', amountMinor: 7 });
    const outcome = reducePull(
      pending,
      page({ epoch: 'epoch-2', transactions: [serverRow({ id: 'late' })], cursor: 40 }),
      now,
    );
    expect(outcome.hasMore).toBe(true);
    expect(outcome.state.meta).toMatchObject({ cursor: 0, epoch: 'epoch-2' });
    expect([...outcome.state.transactions.keys()]).toEqual(['edited']);
    expect(localEntries(outcome.state)).toMatchObject([{ id: 'edited', amountMinor: 7 }]);
    expect(outcome.state.accounts.size).toBe(0);
    expect(outcome.state.categories.size).toBe(0);
    expect(outcome.state.mutations).toEqual(pending.mutations);
  });

  it('hides pending-review rows from history (BR-21)', () => {
    const { state } = reducePull(
      emptyLocalState(),
      page({ transactions: [serverRow({ reviewStatus: 'pending_review' })] }),
      now,
    );
    expect(state.transactions.size).toBe(1);
    expect(localEntries(state)).toEqual([]);
  });
});

describe('reducePush', () => {
  it('applied: the server row replaces the overlay and the mutation leaves the queue', () => {
    const state = editLocally(syncedState(serverRow()), { amountMinor: 700 });
    const [mutation] = queueOrder(state);
    const next = reducePush(
      state,
      [
        {
          mutationId: mutation!.mutationId,
          status: 'applied',
          transaction: serverRow({ amountMinor: 700, version: 2 }),
        },
      ],
      now,
      ['m-1'],
    );
    expect(next.transactions.get('tx-1')).toMatchObject({ local: null, server: { version: 2 } });
    expect(next.mutations.size).toBe(0);
    expect(localEntries(next)).toHaveLength(1);
  });

  it('applied delete: the entry is gone', () => {
    const state = applyLocalChange(
      syncedState(serverRow()),
      { type: 'delete', id: 'tx-1' },
      sequentialIds(),
    );
    const next = reducePush(
      state,
      [{ mutationId: 'm-1', status: 'applied', transaction: tombstone('tx-1') }],
      now,
      ['m-1'],
    );
    expect(next.transactions.size).toBe(0);
    expect(next.mutations.size).toBe(0);
  });

  it('conflict: the server row stays canonical, the conflict is stored, the entry counts once', () => {
    const state = editLocally(syncedState(serverRow({ version: 1 })), { amountMinor: 1 });
    const next = reducePush(
      state,
      [
        {
          mutationId: 'm-1',
          status: 'conflict',
          conflictId: 'c-9',
          transaction: serverRow({ version: 3, amountMinor: 3000 }),
        },
      ],
      now,
      ['m-1'],
    );
    expect(next.transactions.get('tx-1')).toMatchObject({ local: null, server: { version: 3 } });
    expect(next.conflicts.get('c-9')).toMatchObject({
      transactionId: 'tx-1',
      local: { amountMinor: 1 },
    });
    expect(next.mutations.size).toBe(0);
    expect(localEntries(next)).toMatchObject([{ amountMinor: 3000, sync: { state: 'conflict' } }]);
  });

  it('rejected: the overlay stays and the mutation is marked failed with its code', () => {
    const state = editLocally(syncedState(serverRow()), { categoryId: 'archived' });
    const next = reducePush(
      state,
      [{ mutationId: 'm-1', status: 'rejected', code: 'INVALID_CATEGORY', message: 'archived' }],
      now,
      ['m-1'],
    );
    expect(queueOrder(next)).toMatchObject([
      { state: { status: 'failed', code: 'INVALID_CATEGORY' } },
    ]);
    expect(localEntries(next)).toMatchObject([
      { categoryId: 'archived', sync: { state: 'failed', code: 'INVALID_CATEGORY' } },
    ]);
  });

  it('freezes what is left of its own batch for a replay, never another tab’s push', () => {
    const state = setMutationState(editLocally(syncedState(serverRow()), {}), ['m-1'], {
      status: 'sending',
      since: now,
    });
    expect(queueOrder(reducePush(state, [], now, ['m-1']))[0]?.state).toEqual({
      status: 'retrying',
    });
    expect(queueOrder(reducePush(state, [], now, []))[0]?.state).toEqual({
      status: 'sending',
      since: now,
    });
  });
});

describe('discardFailed', () => {
  const rejected = (state: LocalState) =>
    reducePush(
      state,
      [{ mutationId: 'm-1', status: 'rejected', code: 'INVALID_CATEGORY', message: 'archived' }],
      now,
      ['m-1'],
    );

  it('reverts an edit to the last server row and empties the queue', () => {
    const failed = rejected(editLocally(syncedState(serverRow()), { categoryId: 'archived' }));
    const next = discardFailed(failed, 'tx-1');
    expect(next.transactions.get('tx-1')).toMatchObject({ server: { version: 1 }, local: null });
    expect(next.mutations.size).toBe(0);
    expect(localEntries(next)).toMatchObject([
      { categoryId: serverRow().categoryId, sync: { state: 'synced' } },
    ]);
  });

  it('removes an entry the server never had', () => {
    const failed = rejected(editLocally(syncedState(), { categoryId: 'archived' }));
    const next = discardFailed(failed, 'tx-1');
    expect(next.transactions.size).toBe(0);
    expect(next.mutations.size).toBe(0);
  });

  it('leaves an entry alone unless its only change failed', () => {
    const pending = editLocally(syncedState(serverRow()), { amountMinor: 1 });
    expect(discardFailed(pending, 'tx-1')).toBe(pending);
    const fixed = editLocally(
      rejected(editLocally(syncedState(serverRow()), { categoryId: 'archived' })),
      { categoryId: 'cat-1' },
    );
    expect(discardFailed(fixed, 'tx-1')).toBe(fixed);
  });
});

describe('settleConflict', () => {
  const conflicted = (server = serverRow({ version: 2, amountMinor: 2000 })) =>
    reducePull(
      syncedState(server),
      page({
        conflicts: [
          {
            id: 'c-1',
            transactionId: 'tx-1',
            baseVersion: 1,
            serverVersion: 2,
            local: localRow({ description: 'Mine' }),
            server,
            createdAt: now,
          },
        ],
      }),
      now,
    ).state;

  it('closes the conflict and takes the resolved row', () => {
    const next = settleConflict(
      conflicted(),
      'c-1',
      serverRow({ version: 3, amountMinor: 2000, description: 'Mine' }),
    );
    expect(next.conflicts.size).toBe(0);
    expect(localEntries(next)).toMatchObject([
      { amountMinor: 2000, description: 'Mine', sync: { state: 'synced' } },
    ]);
  });

  it('removes an entry resolved as deleted', () => {
    const next = settleConflict(conflicted(), 'c-1', tombstone('tx-1'));
    expect(next.conflicts.size).toBe(0);
    expect(next.transactions.size).toBe(0);
  });

  it('keeps a change made meanwhile on top of the resolved row', () => {
    const state = editLocally(conflicted(), { amountMinor: 5 });
    const next = settleConflict(state, 'c-1', serverRow({ version: 3 }));
    expect(next.transactions.get('tx-1')).toMatchObject({
      server: { version: 3 },
      local: { amountMinor: 5 },
    });
    expect(queueOrder(next)).toMatchObject([{ baseVersion: 3 }]);
  });

  it('leaves a change already sent on the base it was sent with', () => {
    const state = editLocally(conflicted(), { amountMinor: 5 });
    const sent = setMutationState(state, ['m-1'], { status: 'retrying' });
    const next = settleConflict(sent, 'c-1', serverRow({ version: 3 }));
    expect(queueOrder(next)).toMatchObject([{ baseVersion: 2 }]);
  });
});
