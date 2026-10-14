import type { QueryClient } from '@tanstack/react-query';
import { deleteUserDatabase } from './sync/store';

/** Per-user keys live under this prefix; device-wide preferences (`spending.locale`, `spending.theme`) do not. */
const userStoragePrefix = (userId: string) => `spending.user.${userId}.`;

/**
 * Removes everything this device holds for the user: cached queries, per-user keys and the
 * user's local database. Called on explicit sign-out only: a revoked or expired session keeps
 * local data so queued changes survive until the same user signs in.
 */
export async function clearLocalUserData(queryClient: QueryClient, userId: string): Promise<void> {
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
  await deleteUserDatabase(userId);
}
