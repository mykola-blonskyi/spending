import { api } from '../client';
import { present } from '../session';
import type { SyncTransport } from './engine';

/** The flusher holds the cross-tab lock while it waits, so a hung request must not stall every tab. */
export const SYNC_TIMEOUT_MS = 30_000;

export const apiTransport: SyncTransport = {
  async push(mutations) {
    const { data } = await api.POST('/api/v1/sync/push', {
      body: { mutations },
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    return present(data).results;
  },
  async pull(cursor) {
    const { data } = await api.GET('/api/v1/sync/pull', {
      params: { query: { cursor } },
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    return present(data);
  },
};
