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
