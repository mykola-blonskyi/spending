import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api-error';
import { api, createApiClient } from '../client';
import { setCsrfToken } from '../csrf';
import {
  backoffDelay,
  type FlushLock,
  SyncEngine,
  type SyncTransport,
  userFlushLock,
} from './engine';
import { localRow, page, sequentialIds, serverRow } from './fixtures';
import {
  emptyLocalState,
  type LocalState,
  mutationsFor,
  type PushResult,
  queueOrder,
  type WireMutation,
} from './model';
import { applyLocalChange, requeueInFlight, setMutationState } from './queue';
import { LocalStore } from './store';
import { apiTransport, SYNC_TIMEOUT_MS } from './transport';
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
    async push(mutations, onSent) {
      onSent();
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
    const spy = vi.spyOn(local, 'commit').mockImplementation((transition) => {
      intercepted += 1;
      if (transition !== requeueInFlight) {
        // The edit commits through local.commit too; restore first so it cannot re-enter here.
        spy.mockRestore();
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
    const left = queueOrder(store.state);
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
    const left = queueOrder(store.state);
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
    vi.spyOn(Math, 'random').mockReturnValue(1);
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

  it('leaves another tab’s push in flight alone when its own push fails', async () => {
    store = await LocalStore.open('ann');
    const local = store;
    await recordTransaction(local, { ...draft, description: 'mine' });
    const push = vi.fn<SyncTransport['push']>(async () => {
      // Without Web Locks, another tab may send its own batch meanwhile.
      const id = await recordTransaction(local, { ...draft, description: 'theirs' });
      const theirs = mutationsFor(local.state, id).map((mutation) => mutation.mutationId);
      await local.commit((state) => setMutationState(state, theirs, { status: 'sending' }));
      throw new ApiError({ status: 0, code: 'NETWORK', message: 'offline' });
    });
    const engine = new SyncEngine(local, { push, pull: () => Promise.resolve(page()) });

    await engine.flush();
    engine.stop();

    expect(queueOrder(local.state).map((mutation) => mutation.state.status)).toEqual([
      'queued',
      'sending',
    ]);
  });

  it('gives up a hung push, so the lock passes to the next flush', async () => {
    store = await LocalStore.open('ann');
    const local = store;
    await recordTransaction(local, draft);
    setCsrfToken('tok');
    const timeouts: AbortController[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      expect(ms).toBe(SYNC_TIMEOUT_MS);
      const controller = new AbortController();
      timeouts.push(controller);
      return controller.signal;
    });
    const fetchMock = vi.fn(
      (request: Request) =>
        new Promise<Response>((_resolve, reject) =>
          request.signal.addEventListener('abort', () => reject(request.signal.reason)),
        ),
    );
    const client = createApiClient({ baseUrl: 'http://localhost', fetch: fetchMock });
    vi.spyOn(api, 'POST').mockImplementation(client.POST);
    let held = Promise.resolve();
    const lock: FlushLock = (run) => (held = held.then(run));
    const server = fakeServer();
    const hung = new SyncEngine(local, apiTransport, lock);
    const otherTab = new SyncEngine(local, server.transport, lock);
    let settled: string[] = [];
    hung.subscribe(() => {
      if (hung.getStatus().phase !== 'retrying') return;
      settled = queueOrder(local.state).map((mutation) => mutation.state.status);
    });

    const first = hung.flush();
    const second = otherTab.flush();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    timeouts[0]!.abort(new DOMException('timed out', 'TimeoutError'));
    await first;
    expect(hung.getStatus().phase).toBe('retrying');
    // The request had left, so the server may have applied it: frozen for a replay.
    expect(settled).toEqual(['retrying']);
    hung.stop();
    await second;

    expect(server.pushes).toHaveLength(1);
    expect(local.state.mutations.size).toBe(0);
  });

  it('stops between batches once stopped mid-push', async () => {
    let state = emptyLocalState();
    const ids = sequentialIds();
    for (let i = 0; i < 201; i += 1) {
      state = applyLocalChange(state, { type: 'upsert', row: localRow({ id: `tx-${i}` }) }, ids);
    }
    const memory = {
      get state() {
        return state;
      },
      closed: false,
      commit: (transition: (current: LocalState) => LocalState) =>
        Promise.resolve((state = transition(state))),
    } as unknown as LocalStore;
    const pull = vi.fn(() => Promise.resolve(page()));
    const server = fakeServer({ onPush: () => engine.stop() });
    const engine = new SyncEngine(memory, { ...server.transport, pull });

    await engine.flush();

    expect(server.pushes).toHaveLength(1);
    expect(pull).not.toHaveBeenCalled();
  });

  it('fails a mutation that cannot be sent and still sends the rest', async () => {
    let state = applyLocalChange(
      emptyLocalState(),
      { type: 'upsert', row: localRow({ id: 'good' }) },
      sequentialIds(),
    );
    state = {
      ...state,
      mutations: new Map(state.mutations).set('broken', {
        mutationId: 'broken',
        seq: 2,
        transactionId: 'gone',
        baseVersion: null,
        change: { type: 'transaction.delete' },
        state: { status: 'queued' },
      }),
    };
    const memory = {
      get state() {
        return state;
      },
      closed: false,
      commit: (transition: (current: LocalState) => LocalState) =>
        Promise.resolve((state = transition(state))),
    } as unknown as LocalStore;
    const server = fakeServer();

    await new SyncEngine(memory, server.transport).flush();

    expect(server.pushes.flat().map((m) => m.mutationId)).toEqual(['m-1']);
    expect(queueOrder(state).map((m) => [m.mutationId, m.state.status])).toEqual([
      ['broken', 'failed'],
    ]);
  });
});

describe('userFlushLock', () => {
  const run = () => Promise.resolve();

  it('holds the user’s Web Lock for each flush, so tabs take turns', async () => {
    const request = vi.fn((_name: string, callback: () => Promise<void>) => callback());
    await userFlushLock('ann', { request } as unknown as LockManager)(run);
    expect(request).toHaveBeenCalledWith('spending-sync:ann', run);
  });

  it('flushes uncoordinated where the browser has no Web Locks', async () => {
    const flushed = vi.fn(run);
    await userFlushLock('ann', undefined)(flushed);
    expect(flushed).toHaveBeenCalledOnce();
  });
});

describe('backoffDelay', () => {
  it.each([
    [1, 0, 500],
    [1, 1, 1000],
    [4, 0, 4000],
    [4, 1, 8000],
    [10, 0.5, 225_000],
    [30, 1, 300_000],
  ])('attempt %i with random %d waits %i ms', (attempt, random, expected) => {
    expect(backoffDelay(attempt, () => random)).toBe(expected);
  });
});

describe('a failed push', () => {
  const offline = new ApiError({ status: 0, code: 'NETWORK', message: 'Failed to fetch' });

  async function failOnce(failure: (onSent: () => void) => never) {
    store = await LocalStore.open('ann');
    const id = await recordTransaction(store, { ...draft, description: 'first' });
    const engine = new SyncEngine(store, {
      push: (_mutations, onSent) => Promise.resolve().then(() => failure(onSent)),
      pull: () => Promise.resolve(page()),
    });
    await engine.flush();
    engine.stop();
    return { local: store, id, status: () => queueOrder(store!.state).map((m) => m.state.status) };
  }

  it('freezes mutations whose request left and never answered', async () => {
    const { local, id, status } = await failOnce((onSent) => {
      onSent();
      throw offline;
    });
    expect(status()).toEqual(['retrying']);
    await updateTransaction(local, id, { ...draft, description: 'second' });
    expect(status()).toEqual(['retrying', 'queued']);
  });

  it.each<[string, (onSent: () => void) => never]>([
    [
      'the CSRF token could not be fetched before the request',
      () => {
        throw offline;
      },
    ],
    [
      'the server rate-limited it',
      (onSent) => {
        onSent();
        throw new ApiError({ status: 429, code: 'RATE_LIMITED', message: 'slow down' });
      },
    ],
  ])('keeps mutations editable when %s', async (_, failure) => {
    const { local, id, status } = await failOnce(failure);
    expect(status()).toEqual(['queued']);
    await updateTransaction(local, id, { ...draft, description: 'second' });
    expect(status()).toEqual(['queued']);
    expect(queueOrder(local.state)[0]?.change).toMatchObject({
      transaction: { description: 'second' },
    });
    await deleteTransaction(local, id);
    expect(local.state.transactions.has(id)).toBe(false);
    expect(local.state.mutations.size).toBe(0);
  });

  it('retries a bare 401 instead of stopping as signed out, since only the API envelope proves that', async () => {
    store = await LocalStore.open('ann');
    await recordTransaction(store, draft);
    const engine = new SyncEngine(store, {
      push: () => Promise.reject(new ApiError({ status: 401, code: 'AUTH_REQUIRED', message: '' })),
      pull: () => Promise.resolve(page()),
    });

    await engine.flush();

    expect(engine.getStatus().phase).toBe('retrying');
    expect(queueOrder(store.state).map((m) => m.state.status)).toEqual(['queued']);
    engine.stop();
  });

  it('is not attempted while the browser is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    store = await LocalStore.open('ann');
    await recordTransaction(store, draft);
    const server = fakeServer();
    const engine = new SyncEngine(store, server.transport);

    await engine.flush();

    expect(server.pushes).toEqual([]);
    expect(queueOrder(store.state).map((m) => m.state.status)).toEqual(['queued']);
    expect(engine.getStatus().phase).toBe('idle');
  });
});
