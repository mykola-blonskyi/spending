import { createContext, use } from 'react';
import type { Session } from '@data/session';

export const SessionContext = createContext<Session | null>(null);

/** The signed-in session. Only valid below `RequireSession`. */
export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error('useSession must be used inside RequireSession');
  return session;
}
