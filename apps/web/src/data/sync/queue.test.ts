import { describe, expect, it } from 'vitest';
import { localRow, sequentialIds, serverRow, syncedState } from './fixtures';
import { DELETED, emptyLocalState, type LocalState, queueOrder } from './model';
import { reducePush } from './push';
import { applyLocalChange, requeueInFlight, selectBatch, setMutationState } from './queue';

const now = '2026-10-15T00:00:00.000Z';

function sendAll(state: LocalState): LocalState {
  return setMutationState(
    state,
    selectBatch(state).map((m) => m.mutationId),
    { status: 'sending' },
  );
}

describe('applyLocalChange', () => {
  it('records a new entry as an overlay and one queued create', () => {
    const state = applyLocalChange(
      emptyLocalState(),
      { type: 'upsert', row: localRow() },
      sequentialIds(),
    );
    expect(state.transactions.get('tx-1')).toMatchObject({ server: null, local: localRow() });
    expect(queueOrder(state)).toMatchObject([
      { mutationId: 'm-1', baseVersion: null, state: { status: 'queued' } },
    ]);
  });

  it('coalesces queued edits into the first mutation, keeping its ID and base version', () => {
    const ids = sequentialIds();
    let state = syncedState(serverRow({ version: 3 }));
    state = applyLocalChange(state, { type: 'upsert', row: localRow({ amountMinor: 100 }) }, ids);
    state = applyLocalChange(state, { type: 'upsert', row: localRow({ amountMinor: 200 }) }, ids);
    expect(queueOrder(state)).toHaveLength(1);
    expect(queueOrder(state)[0]).toMatchObject({
      mutationId: 'm-1',
      baseVersion: 3,
      change: { type: 'transaction.upsert', transaction: { amountMinor: 200 } },
    });
  });

  it('turns a queued edit into a delete with the same ID and base', () => {
    const ids = sequentialIds();
    let state = syncedState(serverRow({ version: 2 }));
    state = applyLocalChange(state, { type: 'upsert', row: localRow({ amountMinor: 1 }) }, ids);
    state = applyLocalChange(state, { type: 'delete', id: 'tx-1' }, ids);
    expect(queueOrder(state)).toMatchObject([
      { mutationId: 'm-1', baseVersion: 2, change: { type: 'transaction.delete' } },
    ]);
    expect(state.transactions.get('tx-1')?.local).toEqual(DELETED);
  });

  it('cancels a queued create when the entry is deleted, so nothing is sent', () => {
    const ids = sequentialIds();
    let state = applyLocalChange(emptyLocalState(), { type: 'upsert', row: localRow() }, ids);
    state = applyLocalChange(state, { type: 'delete', id: 'tx-1' }, ids);
    expect(state.transactions.size).toBe(0);
    expect(state.mutations.size).toBe(0);
  });

  it('never touches a mutation already sent: the change queues behind it', () => {
    const ids = sequentialIds();
    let state = syncedState(serverRow({ version: 4 }));
    state = applyLocalChange(state, { type: 'upsert', row: localRow({ amountMinor: 1 }) }, ids);
    state = sendAll(state);
    state = applyLocalChange(state, { type: 'upsert', row: localRow({ amountMinor: 2 }) }, ids);
    expect(queueOrder(state)).toMatchObject([
      {
        mutationId: 'm-1',
        state: { status: 'sending' },
        change: { transaction: { amountMinor: 1 } },
      },
      { mutationId: 'm-2', state: { status: 'queued' }, baseVersion: 4 },
    ]);
    expect(selectBatch(requeueInFlight(state)).map((m) => m.mutationId)).toEqual(['m-1']);
  });

  it('rebases a change queued behind an applied one onto the new server version', () => {
    const ids = sequentialIds();
    let state = applyLocalChange(emptyLocalState(), { type: 'upsert', row: localRow() }, ids);
    state = sendAll(state);
    state = applyLocalChange(state, { type: 'delete', id: 'tx-1' }, ids);
    state = reducePush(
      state,
      [{ mutationId: 'm-1', status: 'applied', transaction: serverRow({ version: 1 }) }],
      now,
    );
    expect(queueOrder(state)).toMatchObject([
      { mutationId: 'm-2', baseVersion: 1, change: { type: 'transaction.delete' } },
    ]);
    expect(state.transactions.get('tx-1')).toMatchObject({
      server: { version: 1 },
      local: DELETED,
    });
  });

  it('replaces a failed mutation with a fresh one, since the old ID has a stored outcome', () => {
    const ids = sequentialIds();
    let state = syncedState(serverRow({ version: 5 }));
    state = applyLocalChange(state, { type: 'upsert', row: localRow({ categoryId: 'old' }) }, ids);
    state = setMutationState(state, ['m-1'], {
      status: 'failed',
      code: 'INVALID_CATEGORY',
      message: '',
    });
    state = applyLocalChange(state, { type: 'upsert', row: localRow({ categoryId: 'new' }) }, ids);
    expect(queueOrder(state)).toMatchObject([
      { mutationId: 'm-2', baseVersion: 5, state: { status: 'queued' } },
    ]);
  });
});
