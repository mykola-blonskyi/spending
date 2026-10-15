import { afterEach, describe, expect, it } from 'vitest';
import { clearLocalUserData } from './local-data';
import { createQueryClient } from './query-client';

describe('clearLocalUserData', () => {
  afterEach(() => localStorage.clear());

  it("removes the user's cached queries, but not device preferences", async () => {
    const client = createQueryClient();
    client.setQueryData(['me'], { id: 'ann' });
    localStorage.setItem('spending.locale', 'uk');

    await clearLocalUserData(client, 'ann');

    expect(client.getQueryCache().getAll()).toEqual([]);
    expect(localStorage.getItem('spending.locale')).toBe('uk');
  });
});
