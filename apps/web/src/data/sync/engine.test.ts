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
    vi.spyOn(local, 'commit').mockImplementation((transition) => {
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
