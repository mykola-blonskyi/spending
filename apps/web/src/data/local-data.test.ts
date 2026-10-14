import { afterEach, describe, expect, it } from 'vitest';
import { clearLocalUserData } from './local-data';
import { createQueryClient } from './query-client';

describe('clearLocalUserData', () => {
  afterEach(() => localStorage.clear());

  it("removes the user's cached queries and keys, but not other users' or device preferences", async () => {
    const client = createQueryClient();
    client.setQueryData(['me'], { id: 'ann' });
    localStorage.setItem('spending.user.ann.cursor', '1');
    localStorage.setItem('spending.user.bob.cursor', '2');
    localStorage.setItem('spending.locale', 'uk');

    await clearLocalUserData(client, 'ann');

    expect(client.getQueryCache().getAll()).toEqual([]);
    expect(localStorage.getItem('spending.user.ann.cursor')).toBeNull();
    expect(localStorage.getItem('spending.user.bob.cursor')).toBe('2');
    expect(localStorage.getItem('spending.locale')).toBe('uk');
  });
});
