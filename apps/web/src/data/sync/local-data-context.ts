import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { SyncStatus } from '@shared/components';
import { useOnlineStatus } from '@shared/lib/network';
import type { EngineStatus, SyncEngine } from './engine';
import type {
  Account,
  Category,
  Conflict,
  LocalState,
  Resolution,
  SyncMeta,
  Workspace,
} from './model';
import {
  localEntries,
  queryTransactions,
  type TransactionEntry,
  type TransactionFilter,
} from './query';
import { deriveSyncStatus, smoothingDelay } from './status';
import type { LocalStore } from './store';
import {
  deleteTransaction,
  discardChange,
  recordTransaction,
  resolveConflict,
  type TransactionDraft,
  updateTransaction,
} from './writes';

export type LocalData =
  | { readonly status: 'opening' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly store: LocalStore; readonly engine: SyncEngine };

export const LocalDataContext = createContext<LocalData>({ status: 'opening' });

const subscribeNothing = () => () => {};
const nothing = () => null;

function useReady() {
  const data = use(LocalDataContext);
  return data.status === 'ready' ? data : null;
}

/** Whether this device has a local store yet, so screens can tell "opening" from "unavailable". */
export function useLocalDataStatus(): LocalData['status'] {
  return use(LocalDataContext).status;
}

function useLocalState(): LocalState | null {
  const store = useReady()?.store;
  return useSyncExternalStore(store?.subscribe ?? subscribeNothing, store?.getState ?? nothing);
}

function useEngineStatus(): EngineStatus | null {
  const engine = useReady()?.engine;
  return useSyncExternalStore(engine?.subscribe ?? subscribeNothing, engine?.getStatus ?? nothing);
}

type LocalList<T> = { readonly ready: boolean; readonly items: readonly T[] };

/** History from the local store. Pass a memoized filter: a new object recomputes the list. */
export function useLocalTransactions(filter: TransactionFilter): LocalList<TransactionEntry> {
  const state = useLocalState();
  return useMemo(
    () => ({ ready: state !== null, items: state ? queryTransactions(state, filter) : [] }),
    [state, filter],
  );
}

export function useLocalTransaction(id: string): {
  ready: boolean;
  entry: TransactionEntry | undefined;
} {
  const state = useLocalState();
  return useMemo(() => {
    if (!state) return { ready: false, entry: undefined };
    return { ready: true, entry: localEntries(state).find((entry) => entry.id === id) };
  }, [state, id]);
}

function useSorted<T extends { name: string }>(
  pick: (state: LocalState) => ReadonlyMap<string, T>,
): LocalList<T> {
  const state = useLocalState();
  const collection = state ? pick(state) : null;
  return useMemo(
    () => ({
      ready: collection !== null,
      items: collection
        ? [...collection.values()].sort((a, b) => a.name.localeCompare(b.name))
        : [],
    }),
    [collection],
  );
}

export const useAccounts = (): LocalList<Account> => useSorted((state) => state.accounts);
export const useCategories = (): LocalList<Category> => useSorted((state) => state.categories);
export const useWorkspaces = (): LocalList<Workspace> => useSorted((state) => state.workspaces);

/** Open conflicts, newest first. */
export function useConflicts(): LocalList<Conflict> {
  const conflicts = useLocalState()?.conflicts ?? null;
  return useMemo(
    () => ({
      ready: conflicts !== null,
      items: conflicts
        ? [...conflicts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        : [],
    }),
    [conflicts],
  );
}

/** Null while there is no local store to report on (opening, or IndexedDB unavailable). */
export function useSyncStatus(): SyncStatus | null {
  const state = useLocalState();
  const engine = useEngineStatus();
  const online = useOnlineStatus();
  return useSmoothed(state && engine ? deriveSyncStatus(engine, state, online) : null);
}

const count = (status: SyncStatus | null) => (status && 'count' in status ? status.count : null);
const sameStatus = (a: SyncStatus | null, b: SyncStatus | null) =>
  a?.state === b?.state && count(a) === count(b);

function useSmoothed(next: SyncStatus | null): SyncStatus | null {
  // `target` keeps its identity while the status is equal, so a re-render never restarts a timer.
  const [target, setTarget] = useState(next);
  const [shown, setShown] = useState(next);
  const shownAt = useRef(0);
  if (!sameStatus(next, target)) setTarget(next);

  useEffect(() => {
    if (sameStatus(target, shown)) return;
    const delay =
      target && shown ? smoothingDelay(target, shown, performance.now() - shownAt.current) : 0;
    const timer = setTimeout(() => {
      shownAt.current = performance.now();
      setShown(target);
    }, delay);
    return () => clearTimeout(timer);
  }, [target, shown]);

  return shown;
}

/** When a pull last reached the end; undefined while there is no local store. */
export function useSyncMeta(): SyncMeta | undefined {
  return useLocalState()?.meta;
}

/** The first sync on an empty device: active until a pull first reaches the end. */
export function useInitialSync(): { active: boolean; loaded: number } {
  const state = useLocalState();
  const engine = useEngineStatus();
  const active =
    state !== null && state.meta.lastSyncedAt === null && engine?.phase !== 'authRequired';
  return { active, loaded: state?.transactions.size ?? 0 };
}

/**
 * Pushes and pulls now, e.g. after a REST write to accounts or categories, joining or leaving a
 * workspace, or when the server generated rows. A no-op without a store.
 */
export function useSyncNow(): () => Promise<void> {
  const engine = useReady()?.engine;
  return useCallback(async () => {
    await engine?.flush();
  }, [engine]);
}

function useWriter<A extends unknown[], R>(
  write: (store: LocalStore, ...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  const ready = useReady();
  return useCallback(
    async (...args: A) => {
      if (!ready) throw new Error('The local store is not open');
      const result = await write(ready.store, ...args);
      ready.engine.notifyLocalWrite();
      return result;
    },
    [ready, write],
  );
}

export const useRecordTransaction = (): ((draft: TransactionDraft) => Promise<string>) =>
  useWriter(recordTransaction);
export const useUpdateTransaction = (): ((
  id: string,
  draft: TransactionDraft,
  editedVersion?: number | null,
) => Promise<void>) => useWriter(updateTransaction);
export const useDeleteTransaction = (): ((id: string) => Promise<void>) =>
  useWriter(deleteTransaction);
export const useDiscardChange = (): ((id: string) => Promise<void>) => useWriter(discardChange);
export const useResolveConflict = (): ((
  conflictId: string,
  resolution: Resolution,
) => Promise<void>) => useWriter(resolveConflict);
