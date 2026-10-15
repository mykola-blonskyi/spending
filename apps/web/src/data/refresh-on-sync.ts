import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useLastSyncedAt } from './sync';

/**
 * Server figures move with every synced transaction, including ones recorded on other screens,
 * so each completed sync refetches the queries under `queryKey` (a module constant).
 */
export function useRefreshOnSync(queryKey: QueryKey): void {
  const syncedAt = useLastSyncedAt();
  const queryClient = useQueryClient();
  const previous = useRef(syncedAt);
  useEffect(() => {
    if (previous.current !== undefined && syncedAt !== previous.current) {
      void queryClient.invalidateQueries({ queryKey });
    }
    previous.current = syncedAt;
  }, [syncedAt, queryClient, queryKey]);
}
