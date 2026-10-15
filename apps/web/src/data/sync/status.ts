import type { SyncStatus } from '@shared/components';
import type { EngineStatus } from './engine';
import type { LocalState } from './model';
import { countMutations } from './queue';

/**
 * The one sync state the user sees, by priority: a lost session, then conflicts, failed
 * changes, being offline, an active sync, a retry wait, pending changes, and finally synced.
 */
export function deriveSyncStatus(
  engine: EngineStatus,
  state: LocalState,
  online: boolean,
): SyncStatus {
  const { pending, failed } = countMutations(state);
  const conflicts = state.conflicts.size;
  if (engine.phase === 'authRequired') return { state: 'authRequired' };
  if (conflicts > 0) return { state: 'conflict', count: conflicts };
  if (failed > 0) return { state: 'failed', count: failed };
  if (!online) return { state: 'offline', count: pending };
  if (engine.phase === 'syncing') return { state: 'syncing' };
  if (engine.phase === 'retrying') return { state: 'retrying' };
  if (pending > 0) return { state: 'pending', count: pending };
  return { state: 'synced' };
}

export const SYNCING_DELAY_MS = 300;
export const SYNCED_HOLD_MS = 600;

/**
 * How long the badge waits before showing `next` in place of `shown`, which has been on screen
 * for `shownForMs`. A short sync never flashes "syncing", and "synced" stays long enough to read.
 */
export function smoothingDelay(next: SyncStatus, shown: SyncStatus, shownForMs: number): number {
  if (next.state === shown.state) return 0;
  const hold = shown.state === 'synced' ? Math.max(0, SYNCED_HOLD_MS - shownForMs) : 0;
  return next.state === 'syncing' ? Math.max(SYNCING_DELAY_MS, hold) : hold;
}
