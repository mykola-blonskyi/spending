import { type DBSchema, deleteDB, type IDBPDatabase, openDB } from 'idb';
import {
  type Account,
  type Category,
  type Conflict,
  INITIAL_META,
  type LocalState,
  type QueuedMutation,
  type SyncMeta,
  type TransactionRecord,
  type Workspace,
} from './model';

interface LocalSchema extends DBSchema {
  transactions: { key: string; value: TransactionRecord; indexes: { workspaceId: string } };
  accounts: { key: string; value: Account };
  categories: { key: string; value: Category };
  workspaces: { key: string; value: Workspace };
  conflicts: { key: string; value: Conflict };
  mutations: { key: string; value: QueuedMutation; indexes: { seq: number } };
  meta: { key: 'sync'; value: SyncMeta };
}

type Database = IDBPDatabase<LocalSchema>;
type KeyedStore = 'transactions' | 'accounts' | 'categories' | 'workspaces' | 'conflicts';

const STORES = [
  'transactions',
  'accounts',
  'categories',
  'workspaces',
  'conflicts',
  'mutations',
  'meta',
] as const;

/** One entry per schema version; opening runs every migration above the stored version. */
const MIGRATIONS: readonly ((db: Database) => void)[] = [
  (db) => {
    db.createObjectStore('transactions', { keyPath: 'id' }).createIndex(
      'workspaceId',
      'workspaceId',
    );
    db.createObjectStore('accounts', { keyPath: 'id' });
    db.createObjectStore('categories', { keyPath: 'id' });
    db.createObjectStore('workspaces', { keyPath: 'id' });
    db.createObjectStore('conflicts', { keyPath: 'id' });
    db.createObjectStore('mutations', { keyPath: 'mutationId' }).createIndex('seq', 'seq', {
      unique: true,
    });
    db.createObjectStore('meta');
  },
];

const REGISTRY_KEY = 'spending.localDatabases';

export const databaseName = (userId: string) => `spending-${userId}`;

/** Names of the per-user databases on this device, so another user's can be found and deleted. */
export function localDatabaseNames(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((name) => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

function writeRegistry(names: readonly string[]): void {
  try {
    if (names.length === 0) localStorage.removeItem(REGISTRY_KEY);
    else localStorage.setItem(REGISTRY_KEY, JSON.stringify(names));
  } catch {
    // Without storage the registry cannot be kept; the databases themselves still work.
  }
}

function diff<V>(prev: ReadonlyMap<string, V>, next: ReadonlyMap<string, V>) {
  const puts: V[] = [];
  const deletes: string[] = [];
  for (const [key, value] of next) if (prev.get(key) !== value) puts.push(value);
  for (const key of prev.keys()) if (!next.has(key)) deletes.push(key);
  return { puts, deletes };
}

/** Writes what changed between two states in one IndexedDB transaction: all of it or none. */
async function persist(db: Database, prev: LocalState, next: LocalState): Promise<void> {
  const tx = db.transaction(STORES, 'readwrite');
  const writes: Promise<unknown>[] = [];
  try {
    const keyed: KeyedStore[] = [
      'transactions',
      'accounts',
      'categories',
      'workspaces',
      'conflicts',
    ];
    for (const name of keyed) {
      const store = tx.objectStore(name);
      const { puts, deletes } = diff<unknown>(prev[name], next[name]);
      for (const value of puts) writes.push(store.put(value as never));
      for (const key of deletes) writes.push(store.delete(key));
    }
    const mutations = tx.objectStore('mutations');
    const changed = diff(prev.mutations, next.mutations);
    for (const key of changed.deletes) writes.push(mutations.delete(key));
    for (const value of changed.puts) writes.push(mutations.put(value));
    if (prev.meta !== next.meta) writes.push(tx.objectStore('meta').put(next.meta, 'sync'));
    await Promise.all([...writes, tx.done]);
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // Already finished aborting.
    }
    await Promise.allSettled([...writes, tx.done]);
    throw error;
  }
}

async function load(db: Database): Promise<LocalState> {
  const tx = db.transaction(STORES, 'readonly');
  const byId = <V extends { id: string }>(rows: V[]) => new Map(rows.map((row) => [row.id, row]));
  const [transactions, accounts, categories, workspaces, conflicts, mutations, meta] =
    await Promise.all([
      tx.objectStore('transactions').getAll(),
      tx.objectStore('accounts').getAll(),
      tx.objectStore('categories').getAll(),
      tx.objectStore('workspaces').getAll(),
      tx.objectStore('conflicts').getAll(),
      tx.objectStore('mutations').getAll(),
      tx.objectStore('meta').get('sync'),
    ]);
  await tx.done;
  return {
    transactions: byId(transactions),
    accounts: byId(accounts),
    categories: byId(categories),
    workspaces: byId(workspaces),
    conflicts: byId(conflicts),
    mutations: new Map(mutations.map((mutation) => [mutation.mutationId, mutation])),
    meta: meta ?? INITIAL_META,
  };
}

export class StoreClosedError extends Error {
  constructor() {
    super('The local store is closed');
    this.name = 'StoreClosedError';
  }
}

/**
 * The only owner of IndexedDB. It holds the user's state in memory and serializes every change:
 * a transition computes the next state, the difference is written in one IndexedDB transaction,
 * and only then do readers see it. A failed write leaves both memory and disk as they were.
 *
 * shortcut: the whole store lives in memory and loads at open; fine for household histories
 * (thousands of rows), move reads to indexes if one user's history nears 100k rows.
 */
export class LocalStore {
  readonly userId: string;
  #db: Database;
  #state: LocalState;
  #closed = false;
  #chain: Promise<unknown> = Promise.resolve();
  #listeners = new Set<() => void>();

  private constructor(userId: string, db: Database, state: LocalState) {
    this.userId = userId;
    this.#db = db;
    this.#state = state;
  }

  static async open(userId: string): Promise<LocalStore> {
    const name = databaseName(userId);
    const db = await openDB<LocalSchema>(name, MIGRATIONS.length, {
      upgrade(database, oldVersion) {
        for (const migrate of MIGRATIONS.slice(oldVersion)) migrate(database);
      },
    });
    const names = localDatabaseNames();
    if (!names.includes(name)) writeRegistry([...names, name]);
    const store = new LocalStore(userId, db, await load(db));
    // Deleting the database (sign-out, another tab) asks open connections to step aside.
    db.addEventListener('versionchange', () => store.close());
    db.addEventListener('close', () => store.close());
    return store;
  }

  get state(): LocalState {
    return this.#state;
  }

  get closed(): boolean {
    return this.#closed;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getState = (): LocalState => this.#state;

  /** Runs `transition` after every earlier one, persists its result, then publishes it. */
  commit(transition: (state: LocalState) => LocalState): Promise<LocalState> {
    const run = this.#chain.then(async () => {
      if (this.#closed) throw new StoreClosedError();
      const prev = this.#state;
      const next = transition(prev);
      if (next === prev) return prev;
      await persist(this.#db, prev, next);
      this.#state = next;
      for (const listener of [...this.#listeners]) listener();
      return next;
    });
    this.#chain = run.catch(() => undefined);
    return run;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
    for (const listener of [...this.#listeners]) listener();
  }
}

type Handle = { opening: Promise<LocalStore>; current: LocalStore | null; refs: number };

const handles = new Map<string, Handle>();

function liveStore(userId: string): LocalStore | null {
  const current = handles.get(userId)?.current;
  return current && !current.closed ? current : null;
}

/**
 * Shares one open store per user within the page; each acquire needs a matching release. A
 * store closed from outside (its database was deleted) is reopened on the next acquire.
 */
export function acquireLocalStore(userId: string): Promise<LocalStore> {
  let handle = handles.get(userId);
  if (!handle || handle.current?.closed) {
    const opening = LocalStore.open(userId);
    const fresh: Handle = { opening, current: null, refs: handle?.refs ?? 0 };
    handle = fresh;
    handles.set(userId, fresh);
    opening.then(
      (store) => {
        fresh.current = store;
      },
      () => {
        if (handles.get(userId) === fresh) handles.delete(userId);
      },
    );
  }
  handle.refs += 1;
  return handle.opening;
}

export function releaseLocalStore(userId: string): void {
  const handle = handles.get(userId);
  if (!handle) return;
  handle.refs -= 1;
  if (handle.refs > 0) return;
  handles.delete(userId);
  handle.opening.then(
    (store) => store.close(),
    () => undefined,
  );
}

/** Mutations the server has not accepted: queued, in flight or failed. Sign-out runs with the store open. */
export function countUnsentMutations(userId: string): number {
  return liveStore(userId)?.state.mutations.size ?? 0;
}

export async function deleteUserDatabase(userId: string): Promise<void> {
  const handle = handles.get(userId);
  handles.delete(userId);
  if (handle)
    await handle.opening.then(
      (store) => store.close(),
      () => undefined,
    );
  const name = databaseName(userId);
  await deleteDB(name);
  writeRegistry(localDatabaseNames().filter((other) => other !== name));
}
