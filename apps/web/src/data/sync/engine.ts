import { ApiError } from '../api-error';
import { isSignedOutError } from '../session';
import type { PullPage, PushResult, QueuedMutation, WireMutation } from './model';
import { toWire } from './model';
import { reducePull } from './pull';
import { reducePush } from './push';
import { requeueInFlight, selectBatch, setMutationState } from './queue';
import { type LocalStore, StoreClosedError, syncChannelName } from './store';

export type SyncTransport = {
  push(mutations: WireMutation[]): Promise<PushResult[]>;
  pull(cursor: number): Promise<PullPage>;
};

export type EngineStatus =
  | { readonly phase: 'idle' }
  | { readonly phase: 'syncing' }
  | { readonly phase: 'retrying' }
  | { readonly phase: 'authRequired' }
  | { readonly phase: 'stopped' };

/** Runs one flush once no other flush of the same queue is running. */
export type FlushLock = (run: () => Promise<void>) => Promise<void>;

/**
 * Each flush holds the user's Web Lock while it runs, so any tab may flush and two never overlap.
 * Without Web Locks, flushes run uncoordinated: the server applies a mutation ID once, so a rare
 * overlapping push is harmless.
 */
export function userFlushLock(userId: string, locks: LockManager | undefined): FlushLock {
  if (!locks) return (run) => run();
  const name = syncChannelName(userId);
  return (run) => locks.request(name, run);
}

export const WRITE_DEBOUNCE_MS = 500;

/** Doubling from 1 s up to 5 min. #26 adds jitter. */
export function backoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 300_000);
}

/** Errors that come from the connection or the server's health, not from what was sent. */
function isTransient(error: ApiError): boolean {
  return (
    error.code === 'NETWORK' ||
    error.code === 'CSRF_FAILED' ||
    error.status === 429 ||
    error.status >= 500
  );
}

/**
 * The flusher: pushes queued mutations in order, applies the results, then pulls until the
 * server has nothing more. Transport errors keep everything queued and retry with backoff. A lost
 * session stops it with everything kept, so the same user can sync after signing in again.
 */
export class SyncEngine {
  readonly #store: LocalStore;
  readonly #transport: SyncTransport;
  readonly #lock: FlushLock;
  #status: EngineStatus = { phase: 'idle' };
  #listeners = new Set<() => void>();
  #running: Promise<void> | null = null;
  #again = false;
  #attempt = 0;
  /** This flush's batch on its way, the only mutations it may settle. */
  #sent: readonly string[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(store: LocalStore, transport: SyncTransport, lock: FlushLock = (run) => run()) {
    this.#store = store;
    this.#transport = transport;
    this.#lock = lock;
  }

  getStatus = (): EngineStatus => this.#status;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  stop(): void {
    this.#schedule(undefined);
    this.#setStatus({ phase: 'stopped' });
  }

  /** A local write was committed: flush once writes settle. */
  notifyLocalWrite(): void {
    // A retry already has a flush scheduled; flushing sooner would only shorten the backoff.
    if (this.#halted() || this.#status.phase === 'retrying') return;
    this.#schedule(WRITE_DEBOUNCE_MS);
  }

  flush(): Promise<void> {
    if (this.#halted()) return Promise.resolve();
    this.#schedule(undefined);
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }
    this.#running = this.#lock(async () => {
      do {
        this.#again = false;
        await this.#run();
      } while (this.#again && this.#status.phase === 'idle');
    }).finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  #halted(): boolean {
    return this.#status.phase === 'stopped' || this.#status.phase === 'authRequired';
  }

  #schedule(delay: number | undefined): void {
    clearTimeout(this.#timer);
    this.#timer = delay === undefined ? undefined : setTimeout(() => void this.flush(), delay);
  }

  #setStatus(status: EngineStatus): void {
    if (this.#status.phase === 'stopped') return;
    this.#status = status;
    for (const listener of [...this.#listeners]) listener();
  }

  async #run(): Promise<void> {
    if (this.#halted()) return;
    this.#setStatus({ phase: 'syncing' });
    try {
      await this.#store.commit(requeueInFlight);
      await this.#pushAll();
      await this.#pullAll();
      this.#attempt = 0;
      this.#setStatus({ phase: 'idle' });
    } catch (error) {
      if (error instanceof StoreClosedError || this.#store.closed) {
        this.stop();
      } else {
        const sent = this.#sent;
        await this.#store.commit((state) => requeueInFlight(state, sent)).catch(() => undefined);
        if (isSignedOutError(error)) {
          this.#setStatus({ phase: 'authRequired' });
          return;
        }
        this.#attempt += 1;
        this.#setStatus({ phase: 'retrying' });
        this.#schedule(backoffDelay(this.#attempt));
      }
    }
  }

  async #pushAll(): Promise<void> {
    while (!this.#halted()) {
      let batch: QueuedMutation[] = [];
      // Selecting inside the commit sends the payloads as they are when marked sending.
      await this.#store.commit((state) => {
        batch = selectBatch(state);
        this.#sent = batch.map((mutation) => mutation.mutationId);
        return batch.length === 0
          ? state
          : setMutationState(state, this.#sent, { status: 'sending' });
      });
      if (batch.length === 0) return;
      const results = await this.#send(batch);
      const now = new Date().toISOString();
      const sent = this.#sent;
      await this.#store.commit((state) => reducePush(state, results, now, sent));
      this.#sent = [];
    }
  }

  /**
   * A request the server refuses as a whole is retried one mutation at a time, so only the
   * invalid one is rejected; a refused single mutation becomes a `rejected` result.
   */
  async #send(batch: readonly QueuedMutation[]): Promise<PushResult[]> {
    try {
      return await this.#transport.push(batch.map(toWire));
    } catch (error) {
      if (!(error instanceof ApiError) || isTransient(error) || isSignedOutError(error)) {
        throw error;
      }
      if (batch.length > 1) {
        const results: PushResult[] = [];
        try {
          for (const mutation of batch) results.push(...(await this.#send([mutation])));
        } catch (failure) {
          // Keep what the server already applied; the flusher requeues the rest.
          if (results.length > 0) {
            const now = new Date().toISOString();
            await this.#store.commit((state) => reducePush(state, results, now, []));
          }
          throw failure;
        }
        return results;
      }
      return [
        {
          mutationId: batch[0]!.mutationId,
          status: 'rejected',
          code: error.code,
          message: error.message,
        },
      ];
    }
  }

  async #pullAll(): Promise<void> {
    let hasMore = true;
    while (hasMore && !this.#halted()) {
      const page = await this.#transport.pull(this.#store.state.meta.cursor);
      const now = new Date().toISOString();
      await this.#store.commit((state) => {
        const outcome = reducePull(state, page, now);
        hasMore = outcome.hasMore;
        return outcome.state;
      });
    }
  }
}
