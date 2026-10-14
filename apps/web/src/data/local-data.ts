import type { QueryClient } from '@tanstack/react-query';

/** Per-user keys live under this prefix; device-wide preferences (`spending.locale`, `spending.theme`) do not. */
const userStoragePrefix = (userId: string) => `spending.user.${userId}.`;

/**
 * Removes everything this device holds for the user. Called on explicit sign-out only: a revoked
 * or expired session keeps local data so queued changes survive until the same user signs in.
 * The offline store (#25, #29) extends this with the user's IndexedDB database and caches.
 */
export function clearLocalUserData(queryClient: QueryClient, userId: string): void {
  queryClient.clear();
  try {
    const prefix = userStoragePrefix(userId);
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
    for (const key of keys) {
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable; then nothing was stored either.
  }
}
