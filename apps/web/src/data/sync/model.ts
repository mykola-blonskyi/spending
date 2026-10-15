import type { components } from '../api.gen';

type Schemas = components['schemas'];
type WireMutation = Schemas['PushDto']['mutations'][number];

export type ServerTransaction = Schemas['TransactionView_Output'];
export type Tombstone = Schemas['Tombstone_Output'];
export type ServerRow = ServerTransaction | Tombstone;
export type PullPage = Schemas['PullResponseDto_Output'];
export type PushResult = Schemas['PushResponseDto_Output']['results'][number];
export type Account = PullPage['accounts'][number];
export type Category = PullPage['categories'][number];
export type Workspace = PullPage['workspaces'][number];
export type Conflict = PullPage['conflicts'][number];
export type TransactionInput = Extract<WireMutation, { type: 'transaction.upsert' }>['transaction'];
export type { WireMutation };

export const DELETED = { deleted: true } as const;
export type Deleted = typeof DELETED;

/** Compares by shape: a value read back from IndexedDB is a copy, never the `DELETED` constant. */
export function isDeleted(local: TransactionRecord['local']): local is Deleted {
  return local !== null && 'deleted' in local;
}

export function isTombstone(row: ServerRow): row is Tombstone {
  return 'deletedAt' in row;
}

/** The optimistic row the user sees while a change is pending. */
export type LocalTransaction = TransactionInput & { createdAt: string };

/**
 * One entry on this device: the last row the server confirmed and, while a change is pending,
 * the optimistic local version. Readers show `local` when present and count it instead of
 * `server`, never both.
 */
export type TransactionRecord = Readonly<{
  id: string;
  workspaceId: string;
  server: ServerTransaction | null;
  local: LocalTransaction | Deleted | null;
}>;

/**
 * Where a queued mutation is in its lifecycle. `applied` and `conflict` are terminal: the
 * mutation leaves the queue, so they never appear here. A push that left but never got an answer
 * leaves it `retrying`: the server may already hold its result under this ID, so, like `sending`,
 * its payload is frozen and it is replayed as is. A push known to have changed nothing (offline,
 * stopped before the request, or refused with a 4xx such as 429) leaves it `queued`.
 */
export type MutationState =
  | { readonly status: 'queued' }
  | { readonly status: 'sending' }
  | { readonly status: 'retrying' }
  | { readonly status: 'failed'; readonly code: string; readonly message: string };

export type MutationChange =
  | { readonly type: 'transaction.upsert'; readonly transaction: TransactionInput }
  | { readonly type: 'transaction.delete' };

export type QueuedMutation = Readonly<{
  mutationId: string;
  seq: number;
  transactionId: string;
  /** The server version the change was derived from; null for a row the server has not confirmed. */
  baseVersion: number | null;
  change: MutationChange;
  state: MutationState;
}>;

export type SyncMeta = Readonly<{
  cursor: number;
  /** When a pull last reached `hasMore: false`. Null until the first full sync completes. */
  lastSyncedAt: string | null;
  nextSeq: number;
}>;

export type LocalState = Readonly<{
  transactions: ReadonlyMap<string, TransactionRecord>;
  accounts: ReadonlyMap<string, Account>;
  categories: ReadonlyMap<string, Category>;
  workspaces: ReadonlyMap<string, Workspace>;
  conflicts: ReadonlyMap<string, Conflict>;
  mutations: ReadonlyMap<string, QueuedMutation>;
  meta: SyncMeta;
}>;

export const INITIAL_META: SyncMeta = { cursor: 0, lastSyncedAt: null, nextSeq: 1 };

export function emptyLocalState(): LocalState {
  return {
    transactions: new Map(),
    accounts: new Map(),
    categories: new Map(),
    workspaces: new Map(),
    conflicts: new Map(),
    mutations: new Map(),
    meta: INITIAL_META,
  };
}

/** The mutations of one entry, oldest first. */
export function mutationsFor(state: LocalState, transactionId: string): QueuedMutation[] {
  return [...state.mutations.values()]
    .filter((mutation) => mutation.transactionId === transactionId)
    .sort((a, b) => a.seq - b.seq);
}

export function queueOrder(state: LocalState): QueuedMutation[] {
  return [...state.mutations.values()].sort((a, b) => a.seq - b.seq);
}

export function toWire(mutation: QueuedMutation): WireMutation {
  if (mutation.change.type === 'transaction.upsert') {
    return {
      mutationId: mutation.mutationId,
      type: 'transaction.upsert',
      baseVersion: mutation.baseVersion,
      transaction: mutation.change.transaction,
    };
  }
  if (mutation.baseVersion === null) {
    throw new Error(`Delete ${mutation.mutationId} has no base version`);
  }
  return {
    mutationId: mutation.mutationId,
    type: 'transaction.delete',
    transactionId: mutation.transactionId,
    baseVersion: mutation.baseVersion,
  };
}

/** Immutable map helpers: unchanged entries keep their identity, which is how the store diffs. */
export function withEntry<V>(map: ReadonlyMap<string, V>, key: string, value: V): Map<string, V> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

export function withoutEntries<V>(
  map: ReadonlyMap<string, V>,
  keys: Iterable<string>,
): Map<string, V> {
  const next = new Map(map);
  for (const key of keys) next.delete(key);
  return next;
}
