import { api } from '../client';
import { present } from '../session';
import type { SyncTransport } from './engine';

export const apiTransport: SyncTransport = {
  async push(mutations) {
    const { data } = await api.POST('/api/v1/sync/push', { body: { mutations } });
    return present(data).results;
  },
  async pull(cursor) {
    const { data } = await api.GET('/api/v1/sync/pull', {
      params: { query: { cursor } },
    });
    return present(data);
  },
};
