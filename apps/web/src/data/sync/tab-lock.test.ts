import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimFlusher, type TabLockEnv } from './tab-lock';

let clock = 0;
const tabs: { release(): void }[] = [];

function env(tabId: string, overrides: Partial<TabLockEnv> = {}): TabLockEnv {
  return {
    locks: undefined,
    broadcast: false,
    storage: localStorage,
    tabId,
    now: () => clock,
    ...overrides,
  };
}

function claim(tabId: string, overrides: Partial<TabLockEnv> = {}) {
  const tab = claimFlusher('ann', env(tabId, overrides));
  tabs.push(tab);
  return tab;
}

async function flushes(tab: ReturnType<typeof claimFlusher>): Promise<boolean> {
  const run = vi.fn(() => Promise.resolve());
  await tab.lock(run);
  return run.mock.calls.length === 1;
}

afterEach(() => {
  for (const tab of tabs.splice(0)) tab.release();
  localStorage.clear();
  clock = 0;
});

describe('claimFlusher without Web Locks or BroadcastChannel', () => {
  it('lets only the first tab flush and makes the others read-only', async () => {
    const first = claim('a');
    const second = claim('b');

    expect(first.readOnly).toBe(false);
    expect(await flushes(first)).toBe(true);
    expect(second.readOnly).toBe(true);
    expect(await flushes(second)).toBe(false);
  });

  it('falls back when only one of the two APIs exists', () => {
    const locks = {} as LockManager;
    claim('a', { locks });
    expect(claim('b', { locks }).readOnly).toBe(true);
    expect(claim('c', { broadcast: true }).readOnly).toBe(true);
  });

  it('keeps the claim when the flushing tab reloads', () => {
    claim('a');
    expect(claim('a').readOnly).toBe(false);
  });

  it('frees the claim when the flushing tab closes', () => {
    claim('a').release();
    expect(claim('b').readOnly).toBe(false);
  });

  it('takes over a claim whose tab stopped renewing it', () => {
    localStorage.setItem('spending-sync:ann', JSON.stringify({ tab: 'gone', at: 0 }));
    clock = 16_000;
    expect(claim('b').readOnly).toBe(false);
  });

  it('flushes alone when storage is unavailable', () => {
    expect(claim('a', { storage: undefined }).readOnly).toBe(false);
  });
});

describe('claimFlusher with Web Locks', () => {
  it('runs flushes only while this tab holds the lock', async () => {
    let grant!: () => void;
    const locks = {
      request: vi.fn(
        (_name: string, _options: LockOptions, callback: () => Promise<void>) =>
          new Promise<void>((resolve) => {
            grant = () => void callback().then(resolve);
          }),
      ),
    } as unknown as LockManager;
    const tab = claim('a', { locks, broadcast: true });
    const run = vi.fn(() => Promise.resolve());

    const flushing = tab.lock(run);
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    grant();
    await flushing;
    expect(run).toHaveBeenCalledOnce();
    expect(tab.readOnly).toBe(false);
    expect(locks.request).toHaveBeenCalledWith(
      'spending-sync:ann',
      expect.anything(),
      expect.any(Function),
    );
  });
});
