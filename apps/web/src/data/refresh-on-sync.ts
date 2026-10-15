import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useSyncStatus } from './sync';

/**
 * Server figures move with every synced transaction, including ones recorded on other screens,
 * so a finished sync refetches the queries under `queryKey` (a module constant).
 */
export function useRefreshOnSync(queryKey: QueryKey): void {
  const state = useSyncStatus()?.state;
  const queryClient = useQueryClient();
  const previous = useRef(state);
  useEffect(() => {
    if (state === 'synced' && previous.current !== undefined && previous.current !== 'synced') {
      void queryClient.invalidateQueries({ queryKey });
    }
    previous.current = state;
  }, [state, queryClient, queryKey]);
}
