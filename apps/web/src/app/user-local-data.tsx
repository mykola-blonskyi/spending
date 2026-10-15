import { LocalDataProvider } from '@data/sync';
import { useSession } from '@features/auth';

/** Gives the signed-in user's screens their own local store and sync engine. */
export function UserLocalData({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  return <LocalDataProvider userId={user.id}>{children}</LocalDataProvider>;
}
