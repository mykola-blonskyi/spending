import type { FlushLock } from './engine';
import { syncChannelName } from './store';

/**
 * Which tab flushes a user's queue. With Web Locks and BroadcastChannel, the tab holding the
 * user's lock is the flusher until it closes, and the next waiting tab takes over. Without them,
 * the first tab claims the queue in localStorage and later tabs are read-only, because they could
 * neither hand the queue over nor see each other's changes.
 */
export type TabLock = {
  readonly lock: FlushLock;
  readonly readOnly: boolean;
  release(): void;
};

export type TabLockEnv = {
  locks: LockManager | undefined;
  broadcast: boolean;
  storage: Storage | undefined;
  /** Survives a reload of the same tab, so a reloaded flusher keeps its claim. */
  tabId: string;
  now: () => number;
};

const HEARTBEAT_MS = 5_000;
const STALE_MS = 15_000;
const TAB_KEY = 'spending.tabId';

function tabId(): string {
  try {
    const id = sessionStorage.getItem(TAB_KEY) ?? crypto.randomUUID();
    sessionStorage.setItem(TAB_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function browserEnv(): TabLockEnv {
  let storage: Storage | undefined;
  try {
    storage = localStorage;
  } catch {
    storage = undefined;
  }
  return {
    locks: typeof navigator === 'undefined' ? undefined : navigator.locks,
    broadcast: typeof BroadcastChannel !== 'undefined',
    storage,
    tabId: tabId(),
    now: Date.now,
  };
}

export function claimFlusher(userId: string, env: TabLockEnv = browserEnv()): TabLock {
  const name = syncChannelName(userId);
  if (env.locks && env.broadcast) {
    const abort = new AbortController();
    let unlock!: () => void;
    const held = new Promise<void>((resolve) => (unlock = resolve));
    const leading = new Promise<void>((resolve) => {
      env
        .locks!.request(name, { signal: abort.signal }, () => {
          resolve();
          return held;
        })
        .catch(() => undefined);
    });
    return {
      readOnly: false,
      lock: (run) => leading.then(run),
      release() {
        abort.abort();
        unlock();
      },
    };
  }

  const tab = env.tabId;
  const claim = () => env.storage?.setItem(name, JSON.stringify({ tab, at: env.now() }));
  const current = holder(env, name);
  if (current !== null && current !== tab) {
    return { readOnly: true, lock: () => Promise.resolve(), release: () => undefined };
  }
  try {
    claim();
  } catch {
    // Without storage no other tab can see the claim either; this tab flushes alone.
  }
  const heartbeat = setInterval(() => {
    try {
      claim();
    } catch {
      // Storage went away; the claim goes stale and another tab may take over after a reload.
    }
  }, HEARTBEAT_MS);
  return {
    readOnly: false,
    lock: (run) => run(),
    release() {
      clearInterval(heartbeat);
      try {
        if (holder(env, name) === tab) env.storage?.removeItem(name);
      } catch {
        // Nothing to clean up without storage.
      }
    },
  };
}

/** The tab holding a fresh claim, or null when nobody does. */
function holder(env: TabLockEnv, name: string): string | null {
  try {
    const value: unknown = JSON.parse(env.storage?.getItem(name) ?? 'null');
    if (
      typeof value === 'object' &&
      value !== null &&
      'tab' in value &&
      'at' in value &&
      typeof value.tab === 'string' &&
      typeof value.at === 'number' &&
      env.now() - value.at < STALE_MS
    ) {
      return value.tab;
    }
  } catch {
    // Unreadable or malformed: treat as unclaimed.
  }
  return null;
}
