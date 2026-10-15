import { api } from '../client';
import { present } from '../session';
import type { SyncTransport } from './engine';

export const apiTransport: SyncTransport = {
  async push(mutations, onSent) {
    const { data } = await api.POST('/api/v1/sync/push', {
      body: { mutations },
      // Runs after the client's own middleware, so only once nothing can stop the request.
      middleware: [{ onRequest: () => void onSent() }],
    });
    return present(data).results;
  },
  async pull(cursor) {
    const { data } = await api.GET('/api/v1/sync/pull', {
      params: { query: { cursor } },
    });
    return present(data);
  },
};
