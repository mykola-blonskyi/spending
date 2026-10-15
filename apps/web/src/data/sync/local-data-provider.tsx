import { useEffect, useState } from 'react';
import { HEARTBEAT_MS, SyncEngine, userFlushLock } from './engine';
import { type LocalData, LocalDataContext } from './local-data-context';
import { acquireLocalStore, deleteOtherUserDatabases, releaseLocalStore } from './store';
import { apiTransport } from './transport';

const visible = () => document.visibilityState === 'visible';

/** Flushes on reconnect, on becoming visible, and on a heartbeat while visible and online. */
function flushTriggers(engine: SyncEngine): () => void {
  const flush = () => void engine.flush();
  const onVisibility = () => {
    if (visible()) flush();
  };
  const heartbeat = setInterval(() => {
    // A retry wait is already scheduled; the heartbeat must not cut the backoff short.
    if (visible() && navigator.onLine && engine.getStatus().phase !== 'retrying') flush();
  }, HEARTBEAT_MS);
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    clearInterval(heartbeat);
    window.removeEventListener('online', flush);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * Opens the signed-in user's local store, after deleting any other user's, and runs its flusher
 * while mounted.
 */
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
    let stopTriggers: (() => void) | undefined;
    let acquired = false;
    deleteOtherUserDatabases(userId)
      .then(() => {
        if (cancelled) return null;
        acquired = true;
        return acquireLocalStore(userId);
      })
      .then(
        (store) => {
          if (cancelled || !store) return;
          const ready = new SyncEngine(store, apiTransport, userFlushLock(userId, navigator.locks));
          engine = ready;
          setData({ status: 'ready', store, engine: ready });
          void ready.flush();
          stopTriggers = flushTriggers(ready);
          void navigator.storage?.persist().catch(() => false);
        },
        () => {
          if (!cancelled) setData({ status: 'unavailable' });
        },
      );
    return () => {
      cancelled = true;
      stopTriggers?.();
      engine?.stop();
      if (acquired) releaseLocalStore(userId);
      setData({ status: 'opening' });
    };
  }, [userId]);

  return <LocalDataContext value={data}>{children}</LocalDataContext>;
}
