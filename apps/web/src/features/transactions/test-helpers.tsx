import { QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import { createQueryClient } from '@data/query-client';
import type { Account, Category } from '@data/sync';
import type { SyncEngine } from '@data/sync/engine';
import { PERSONAL } from '@data/sync/fixtures';
import { type LocalData, LocalDataContext } from '@data/sync/local-data-context';
import type { LocalState } from '@data/sync/model';
import type { LocalStore } from '@data/sync/store';
import { I18nProvider } from '@i18n/index';

const stamp = { revision: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };

export const account = (patch: Partial<Account> = {}): Account => ({
  id: 'acc-card',
  workspaceId: PERSONAL.id,
  name: 'Card',
  kind: 'card',
  currency: 'EUR',
  archivedAt: null,
  ...stamp,
  ...patch,
});

export const category = (patch: Partial<Category> = {}): Category => ({
  id: 'cat-groceries',
  workspaceId: PERSONAL.id,
  name: 'Groceries',
  kind: 'expense',
  color: '#16a34a',
  icon: 'shopping-basket',
  systemKey: 'groceries',
  archivedAt: null,
  ...stamp,
  ...patch,
});

/** An in-memory stand-in for the IndexedDB store and the sync engine behind the real hooks. */
export function fakeLocalData(initial: LocalState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const store = {
    get state() {
      return state;
    },
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    commit: vi.fn(async (transition: (current: LocalState) => LocalState) => {
      state = transition(state);
      for (const listener of listeners) listener();
      return state;
    }),
  };
  const idle = { phase: 'idle' } as const;
  const engine = {
    subscribe: () => () => {},
    getStatus: () => idle,
    notifyLocalWrite: vi.fn(),
  };
  const value: LocalData = {
    status: 'ready',
    store: store as unknown as LocalStore,
    engine: engine as unknown as SyncEngine,
  };
  return { value, store, current: () => state };
}

type Where = { data: LocalData; path: string; route: string };

/**
 * The providers the transaction hooks read, with the router at `path` under `route`.
 * `location()` is where the screen navigated to.
 */
function transactionProviders({ data, path, route }: Where) {
  let location = path;
  function Probe() {
    location = useLocation().pathname;
    return null;
  }
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <LocalDataContext value={data}>
          <MemoryRouter initialEntries={[path]}>
            <Probe />
            <Routes>
              <Route path={route} element={children} />
              <Route path="*" element={null} />
            </Routes>
          </MemoryRouter>
        </LocalDataContext>
      </I18nProvider>
    </QueryClientProvider>
  );
  return { wrapper, location: () => location };
}

export function renderTransactionHook<T>(hook: () => T, where: Where) {
  const { wrapper, location } = transactionProviders(where);
  return { ...renderHook(hook, { wrapper }), location };
}

export function renderTransactionScreen(screen: ReactNode, where: Where) {
  const { wrapper, location } = transactionProviders(where);
  return { ...render(screen, { wrapper }), location };
}
