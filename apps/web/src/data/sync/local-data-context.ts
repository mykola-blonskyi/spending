import { createContext, use, useCallback, useMemo, useSyncExternalStore } from 'react';
import type { SyncStatus } from '@shared/components';
import { useOnlineStatus } from '@shared/lib/network';
import type { EngineStatus, SyncEngine } from './engine';
import type { Account, Category, LocalState, Workspace } from './model';
import {
  localEntries,
  queryTransactions,
  type TransactionEntry,
  type TransactionFilter,
} from './query';
import { deriveSyncStatus } from './status';
import type { LocalStore } from './store';
import {
  deleteTransaction,
  recordTransaction,
  type TransactionDraft,
  updateTransaction,
} from './writes';

export type LocalData =
  | { readonly status: 'opening' }
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'ready';
      readonly store: LocalStore;
      readonly engine: SyncEngine;
      /** Another tab owns the queue and this browser cannot share it (no Web Locks). */
      readonly readOnly: boolean;
    };

export const LocalDataContext = createContext<LocalData>({ status: 'opening' });

const subscribeNothing = () => () => {};
const nothing = () => null;

function useReady() {
  const data = use(LocalDataContext);
  return data.status === 'ready' ? data : null;
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

/** Null while there is no local store to report on (opening, or IndexedDB unavailable). */
export function useSyncStatus(): SyncStatus | null {
  const state = useLocalState();
  const engine = useEngineStatus();
  const online = useOnlineStatus();
  return state && engine ? deriveSyncStatus(engine, state, online) : null;
}

/** True when another tab owns this user's queue and this tab cannot write. */
export function useReadOnlyTab(): boolean {
  return useReady()?.readOnly ?? false;
}

/** The first sync on an empty device: active until a pull first reaches the end. */
export function useInitialSync(): { active: boolean; loaded: number } {
  const state = useLocalState();
  const engine = useEngineStatus();
  const active =
    state !== null && state.meta.lastSyncedAt === null && engine?.phase !== 'authRequired';
  return { active, loaded: state?.transactions.size ?? 0 };
}

function useWriter<A extends unknown[], R>(
  write: (store: LocalStore, ...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  const ready = useReady();
  return useCallback(
    async (...args: A) => {
      if (!ready) throw new Error('The local store is not open');
      if (ready.readOnly) throw new Error('This tab is read-only');
      const result = await write(ready.store, ...args);
      ready.engine.notifyLocalWrite();
      return result;
    },
    [ready, write],
  );
}

export const useRecordTransaction = (): ((draft: TransactionDraft) => Promise<string>) =>
  useWriter(recordTransaction);
export const useUpdateTransaction = (): ((id: string, draft: TransactionDraft) => Promise<void>) =>
  useWriter(updateTransaction);
export const useDeleteTransaction = (): ((id: string) => Promise<void>) =>
  useWriter(deleteTransaction);
