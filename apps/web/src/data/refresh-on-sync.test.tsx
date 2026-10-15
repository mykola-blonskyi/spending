import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { useRefreshOnSync } from './refresh-on-sync';
import type { SyncEngine } from './sync/engine';
import { syncedState } from './sync/fixtures';
import { type LocalData, LocalDataContext } from './sync/local-data-context';
import type { LocalState } from './sync/model';
import type { LocalStore } from './sync/store';

it('refetches after each completed sync that brought changes, even while the badge is pinned', () => {
  let state: LocalState = syncedState();
  const idle = { phase: 'idle' } as const;
  const listeners = new Set<() => void>();
  const data: LocalData = {
    status: 'ready',
    store: {
      getState: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    } as unknown as LocalStore,
    engine: {
      getStatus: () => idle,
      subscribe: () => () => {},
    } as unknown as SyncEngine,
  };
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LocalDataContext value={data}>{children}</LocalDataContext>
    </QueryClientProvider>
  );
  renderHook(() => useRefreshOnSync(['analytics']), { wrapper });
  expect(invalidate).not.toHaveBeenCalled();

  const sync = (cursor: number, lastSyncedAt: string) =>
    act(() => {
      state = { ...state, meta: { ...state.meta, cursor, lastSyncedAt } };
      for (const listener of listeners) listener();
    });
  sync(11, '2026-10-15T10:00:00.000Z');
  sync(11, '2026-10-15T10:01:00.000Z');
  sync(12, '2026-10-15T10:02:00.000Z');
  expect(invalidate).toHaveBeenCalledTimes(2);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['analytics'] });
});
