import type { QueryClient } from '@tanstack/react-query';
import { forgetLastUser } from './session';
import { deleteUserDatabase } from './sync/store';

/**
 * Removes everything this device holds for the user: cached queries, the last-user record and
 * the user's local database. Called on explicit sign-out only: a revoked or expired session keeps
 * local data so queued changes survive until the same user signs in.
 */
export async function clearLocalUserData(queryClient: QueryClient, userId: string): Promise<void> {
  queryClient.clear();
  forgetLastUser();
  await deleteUserDatabase(userId);
}
