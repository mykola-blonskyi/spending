import { api } from '../client';
import { present } from '../session';
import type { SyncTransport } from './engine';
import type { Resolution, ServerRow } from './model';

/**
 * The sync protocol this build speaks. The server refuses an older one with UPGRADE_REQUIRED, so a
 * stale bundle never advances its cursor past rows it would misread. The API's copy is in
 * apps/api/src/sync/mutations.ts; raise both together.
 */
export const SYNC_PROTOCOL = 1;

/** The flusher holds the cross-tab lock while it waits, so a hung request must not stall every tab. */
export const SYNC_TIMEOUT_MS = 30_000;

export const apiTransport: SyncTransport = {
  async push(mutations, onSent) {
    const { data } = await api.POST('/api/v1/sync/push', {
      body: { mutations },
      // Runs after the client's own middleware, so only once nothing can stop the request.
      middleware: [{ onRequest: () => void onSent() }],
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    return present(data).results;
  },
  async pull(cursor) {
    const { data } = await api.GET('/api/v1/sync/pull', {
      params: { query: { cursor, protocol: SYNC_PROTOCOL } },
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    return present(data);
  },
};

export async function postResolution(conflictId: string, body: Resolution): Promise<ServerRow> {
  const { data } = await api.POST('/api/v1/sync/conflicts/{id}/resolve', {
    params: { path: { id: conflictId } },
    body,
    signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
  });
  return present(data).transaction;
}
