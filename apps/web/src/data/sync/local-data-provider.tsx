import { useEffect, useState } from 'react';
import { SyncEngine } from './engine';
import { type LocalData, LocalDataContext } from './local-data-context';
import { acquireLocalStore, releaseLocalStore } from './store';
import { apiTransport } from './transport';

/** Opens the signed-in user's local store and runs its flusher while mounted. */
export function LocalDataProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const [data, setData] = useState<LocalData>({ status: 'opening' });

  useEffect(() => {
    let cancelled = false;
    let engine: SyncEngine | undefined;
    acquireLocalStore(userId).then(
      (store) => {
        if (cancelled) return;
        engine = new SyncEngine(store, apiTransport);
        setData({ status: 'ready', store, engine });
        void engine.start();
      },
      () => {
        if (!cancelled) setData({ status: 'unavailable' });
      },
    );
    return () => {
      cancelled = true;
      engine?.stop();
      releaseLocalStore(userId);
      setData({ status: 'opening' });
    };
  }, [userId]);

  return <LocalDataContext value={data}>{children}</LocalDataContext>;
}
