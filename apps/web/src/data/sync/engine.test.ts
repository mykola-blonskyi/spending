import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api-error';
import { SyncEngine, type SyncTransport } from './engine';
import { localRow, page, sequentialIds, serverRow } from './fixtures';
import { emptyLocalState, type LocalState, type PushResult, type WireMutation } from './model';
import { applyLocalChange, requeueInFlight } from './queue';
import { LocalStore } from './store';
import { deleteTransaction, recordTransaction, updateTransaction } from './writes';

const draft = (({ id: _id, createdAt: _createdAt, ...rest }) => rest)(localRow());
const invalid = () =>
  new ApiError({ status: 422, code: 'VALIDATION_FAILED', message: 'bad', fromEnvelope: true });

/** A server that applies every mutation, refusing whole requests that `refuse` matches. */
function fakeServer(
  options: {
    refuse?: (mutations: WireMutation[]) => boolean;
    onPush?: (mutations: WireMutation[]) => Promise<void> | void;
  } = {},
) {
  const pushes: WireMutation[][] = [];
  const transport: SyncTransport = {
    async push(mutations) {
      pushes.push(mutations);
      await options.onPush?.(mutations);
      if (options.refuse?.(mutations)) throw invalid();
      return mutations.map((mutation): PushResult => {
        if (mutation.type === 'transaction.delete') {
          return {
            mutationId: mutation.mutationId,
            status: 'applied',
            transaction: {
              id: mutation.transactionId,
              workspaceId: 'ws-personal',
              deletedAt: '2026-10-15T00:00:00.000Z',
              revision: 30,
            },
          };
        }
        return {
          mutationId: mutation.mutationId,
          status: 'applied',
          transaction: serverRow({
            ...mutation.transaction,
            version: (mutation.baseVersion ?? 0) + 1,
          }),
        };
      });
    },
    pull: () => Promise.resolve(page()),
  };
  return { transport, pushes };
}

const described = (mutations: WireMutation[]) =>
  mutations.map((m) => (m.type === 'transaction.upsert' ? m.transaction.description : 'delete'));

let store: LocalStore | undefined;

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  store?.close();
  store = undefined;
  for (const db of await indexedDB.databases()) indexedDB.deleteDatabase(db.name ?? '');
  localStorage.clear();
});

describe('SyncEngine', () => {
  it('pushes an edit committed while the batch is being marked as sending', async () => {
    store = await LocalStore.open('ann');
    const local = store;
    const id = await recordTransaction(local, { ...draft, description: 'W1' });
    const server = fakeServer();
    const engine = new SyncEngine(local, server.transport);

    const commit = local.commit.bind(local);
    let edit: Promise<void> | undefined;
    let intercepted = 0;
    vi.spyOn(local, 'commit').mockImplementation((transition) => {
      intercepted += 1;
      if (!edit && transition !== requeueInFlight) {
        edit = updateTransaction(local, id, { ...draft, description: 'W2' });
      }
      return commit(transition);
    });

    await engine.flush();
    await edit;
    await engine.flush();

    expect(server.pushes.flat().map((m) => described([m])[0])).toContain('W2');
    const record = local.state.transactions.get(id);
    const shown = record?.local ?? record?.server;
    expect(shown && 'description' in shown ? shown.description : null).toBe('W2');
    // The edit's own commit must not re-enter the spy (it once recursed until the stack overflowed).
    expect(intercepted).toBe(2);
  });

  it('retries a refused batch one mutation at a time so only the invalid one fails', async () => {
    store = await LocalStore.open('ann');
    const good = await recordTransaction(store, { ...draft, description: 'good' });
    const bad = await recordTransaction(store, { ...draft, description: 'bad' });
    const server = fakeServer({ refuse: (m) => described(m).includes('bad') });

    await new SyncEngine(store, server.transport).flush();

    expect(store.state.transactions.get(good)?.server?.description).toBe('good');
    const left = [...store.state.mutations.values()];
    expect(left.map((m) => [m.transactionId, m.state.status])).toEqual([[bad, 'failed']]);
  });

  it('keeps the single results already applied when the one-at-a-time retry is rate limited', async () => {
    store = await LocalStore.open('ann');
    const ids: string[] = [];
    for (const description of ['a', 'b', 'c', 'd']) {
      ids.push(await recordTransaction(store, { ...draft, description }));
    }
    let limited = true;
    let singles = 0;
    const server = fakeServer({
      refuse: (m) => m.length > 1,
      onPush: (m) => {
        if (m.length === 1 && limited && ++singles > 2) {
          throw new ApiError({ status: 429, code: 'RATE_LIMITED', message: 'slow down' });
        }
      },
    });
    const pull = vi.spyOn(server.transport, 'pull');
    const engine = new SyncEngine(store, server.transport);

    await engine.flush();

    expect(engine.getStatus().phase).toBe('retrying');
    expect(pull).not.toHaveBeenCalled();
    const shown = (id: string) => store?.state.transactions.get(id)?.server?.description;
    expect(ids.map(shown)).toEqual(['a', 'b', undefined, undefined]);
    const left = [...store.state.mutations.values()];
    expect(left.map((m) => [m.transactionId, m.state.status])).toEqual([
      [ids[2], 'queued'],
      [ids[3], 'queued'],
    ]);

    limited = false;
    await engine.flush();

    expect(ids.map(shown)).toEqual(['a', 'b', 'c', 'd']);
    expect(store.state.mutations.size).toBe(0);
    expect(server.pushes.filter((m) => m.length === 1).map(described)).toEqual([
      ['a'],
      ['b'],
      ['c'],
      ['c'],
      ['d'],
    ]);
    expect(pull).toHaveBeenCalled();
    engine.stop();
  });

  it('sends a change queued behind a refused mutation instead of stranding it', async () => {
    store = await LocalStore.open('ann');
    const local = store;
    const id = await recordTransaction(local, { ...draft, description: 'bad' });
    let fixed: Promise<void> | undefined;
    const server = fakeServer({
      refuse: (m) => described(m).includes('bad'),
      onPush: () => {
        fixed ??= updateTransaction(local, id, { ...draft, description: 'fixed' });
        return fixed;
      },
    });

    await new SyncEngine(local, server.transport).flush();

    expect(local.state.transactions.get(id)?.server?.description).toBe('fixed');
    expect(local.state.mutations.size).toBe(0);
  });

  it('forgets a never-synced entry deleted while its refused create was in flight', async () => {
    store = await LocalStore.open('ann');
    const local = store;
    const id = await recordTransaction(local, { ...draft, description: 'bad' });
    let deleted: Promise<void> | undefined;
    const server = fakeServer({
      refuse: (m) => described(m).includes('bad'),
      onPush: () => {
        deleted ??= deleteTransaction(local, id);
        return deleted;
      },
    });

    await new SyncEngine(local, server.transport).flush();

    expect(local.state.transactions.has(id)).toBe(false);
    expect(local.state.mutations.size).toBe(0);
  });

  it('keeps waiting out the backoff when a local write arrives while retrying', async () => {
    vi.useFakeTimers();
    let state = applyLocalChange(
      emptyLocalState(),
      { type: 'upsert', row: localRow() },
      sequentialIds(),
    );
    const memory = {
      get state() {
        return state;
      },
      closed: false,
      commit: (transition: (current: LocalState) => LocalState) =>
        Promise.resolve((state = transition(state))),
    } as unknown as LocalStore;
    const push = vi.fn<SyncTransport['push']>(() =>
      Promise.reject(new ApiError({ status: 0, code: 'NETWORK', message: 'offline' })),
    );
    const engine = new SyncEngine(memory, { push, pull: () => Promise.resolve(page()) });

    await engine.flush();
    expect(engine.getStatus().phase).toBe('retrying');
    engine.notifyLocalWrite();

    await vi.advanceTimersByTimeAsync(999);
    expect(push).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(push).toHaveBeenCalledTimes(2);
    engine.stop();
  });
});
