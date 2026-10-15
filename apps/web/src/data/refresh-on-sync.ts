import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useSyncMeta } from './sync';

/**
 * Server figures move with every synced transaction, including ones recorded on other screens,
 * so a completed sync refetches the queries under `queryKey` (a module constant) when it is the
 * first or its cursor moved. A heartbeat that brought nothing refetches nothing.
 */
export function useRefreshOnSync(queryKey: QueryKey): void {
  const meta = useSyncMeta();
  const syncedAt = meta?.lastSyncedAt;
  const cursor = meta?.cursor;
  const queryClient = useQueryClient();
  const previous = useRef({ syncedAt, cursor });
  useEffect(() => {
    const last = previous.current;
    if (syncedAt === last.syncedAt) return;
    if (last.syncedAt !== undefined && (last.syncedAt === null || cursor !== last.cursor)) {
      void queryClient.invalidateQueries({ queryKey });
    }
    previous.current = { syncedAt, cursor };
  }, [syncedAt, cursor, queryClient, queryKey]);
}
