import { useEffect, useState } from 'react';
import { SyncEngine } from './engine';
import { type LocalData, LocalDataContext } from './local-data-context';
import { acquireLocalStore, releaseLocalStore } from './store';
import { claimFlusher } from './tab-lock';
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
    let unsubscribe: (() => void) | undefined;
    const flusher = claimFlusher(userId);
    acquireLocalStore(userId).then(
      (store) => {
        if (cancelled) return;
        const ready = new SyncEngine(store, apiTransport, flusher.lock);
        engine = ready;
        // Another tab's write reaches the flusher here; elsewhere it only waits for the lock.
        unsubscribe = store.subscribeRemote(() => ready.notifyLocalWrite());
        setData({ status: 'ready', store, engine: ready, readOnly: flusher.readOnly });
        void ready.flush();
      },
      () => {
        if (!cancelled) setData({ status: 'unavailable' });
      },
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
      engine?.stop();
      flusher.release();
      releaseLocalStore(userId);
      setData({ status: 'opening' });
    };
  }, [userId]);

  return <LocalDataContext value={data}>{children}</LocalDataContext>;
}
