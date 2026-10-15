import type { QueryClient } from '@tanstack/react-query';
import { onAuthLost } from '@data/auth-events';
import { forgetLastUser, sessionQuery } from '@data/session';
import { signInPath } from './return-to';

/**
 * When a signed-in session ends (SESSION_REVOKED or AUTH_REQUIRED on any request), drop the
 * in-memory server state and go to sign-in, keeping the current location as returnTo.
 * Persistent local data stays: queued changes must survive until the same user signs in again.
 * A 401 before any session was known is the normal signed-out path and is left to the guards.
 */
export function installAuthLostHandler(
  queryClient: QueryClient,
  navigate: (to: string) => void,
): () => void {
  return onAuthLost((code) => {
    if (!queryClient.getQueryData(sessionQuery.queryKey)) return;
    queryClient.clear();
    forgetLastUser();
    queryClient.setQueryData(sessionQuery.queryKey, null);
    const { pathname, search } = window.location;
    navigate(signInPath(pathname + search, code));
  });
}
