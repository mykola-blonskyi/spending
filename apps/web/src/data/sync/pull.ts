import {
  isTombstone,
  type LocalState,
  mutationsFor,
  type PullPage,
  type QueuedMutation,
  queueOrder,
  type ServerRow,
  type TransactionRecord,
  withoutEntries,
} from './model';

export type PullOutcome = Readonly<{ state: LocalState; hasMore: boolean }>;

const NO_ACCESS = { status: 'failed', code: 'NO_ACCESS', message: 'NO_ACCESS' } as const;

function upsertAll<V extends { id: string; workspaceId: string }>(
  current: ReadonlyMap<string, V>,
  rows: readonly V[],
  visible: ReadonlySet<string>,
): Map<string, V> {
  const next = new Map(current);
  for (const row of rows) next.set(row.id, row);
  for (const [id, row] of next) if (!visible.has(row.workspaceId)) next.delete(id);
  return next;
}

/**
 * Changes to entries of a workspace the actor left can never be applied. Each such entry keeps
 * only its latest change, failed with NO_ACCESS, so the user sees why and can discard it.
 */
function failWithoutAccess(
  state: LocalState,
  visible: ReadonlySet<string>,
): Map<string, QueuedMutation> {
  const mutations = new Map(state.mutations);
  const latest = new Map<string, QueuedMutation>();
  for (const mutation of queueOrder(state)) {
    const record = state.transactions.get(mutation.transactionId);
    if (!record || visible.has(record.workspaceId)) continue;
    const earlier = latest.get(mutation.transactionId);
    if (earlier) mutations.delete(earlier.mutationId);
    latest.set(mutation.transactionId, mutation);
  }
  for (const mutation of latest.values()) {
    if (mutation.state.status !== 'failed' || mutation.state.code !== NO_ACCESS.code) {
      mutations.set(mutation.mutationId, { ...mutation, state: NO_ACCESS });
    }
  }
  return mutations;
}

/** A row with a pending change keeps its overlay and only refreshes the stored server row. */
function applyServerRow(
  transactions: Map<string, TransactionRecord>,
  row: ServerRow,
  pending: boolean,
): void {
  const current = transactions.get(row.id);
  if (pending && current) {
    if (!isTombstone(row)) transactions.set(row.id, { ...current, server: row });
  } else if (isTombstone(row)) {
    transactions.delete(row.id);
  } else {
    transactions.set(row.id, {
      id: row.id,
      workspaceId: row.workspaceId,
      server: row,
      local: null,
    });
  }
}

/**
 * Applies one pull page. Rows without a pending local change take the server state. For rows
 * with one, only the stored server row is refreshed and the overlay stays; the next push decides
 * between applied and conflict. Conflicts arrive as the full open list.
 *
 * Workspaces (BR-17): rows outside the actor's workspaces are dropped, except entries with
 * pending changes, which stay as failed with NO_ACCESS. A workspace that appeared after the first
 * sync holds rows older than the cursor, so the cursor goes back to 0.
 */
export function reducePull(state: LocalState, page: PullPage, now: string): PullOutcome {
  if (state.meta.epoch !== null && state.meta.epoch !== page.epoch) return restart(state, page);
  const workspaces = new Map(page.workspaces.map((workspace) => [workspace.id, workspace]));
  const visible = new Set(workspaces.keys());
  const joined =
    state.workspaces.size > 0 && page.workspaces.some((w) => !state.workspaces.has(w.id));
  const pending = new Set([...state.mutations.values()].map((m) => m.transactionId));

  const transactions = new Map(state.transactions);
  for (const row of page.transactions) applyServerRow(transactions, row, pending.has(row.id));
  for (const [id, record] of transactions) {
    if (!visible.has(record.workspaceId) && !pending.has(id)) transactions.delete(id);
  }

  const hasMore = joined || page.hasMore;
  return {
    state: {
      ...state,
      transactions,
      accounts: upsertAll(state.accounts, page.accounts, visible),
      categories: upsertAll(state.categories, page.categories, visible),
      workspaces,
      mutations: failWithoutAccess({ ...state, transactions }, visible),
      conflicts: new Map(page.conflicts.map((conflict) => [conflict.id, conflict])),
      meta: {
        ...state.meta,
        cursor: joined ? 0 : page.cursor,
        epoch: page.epoch,
        lastSyncedAt: hasMore ? state.meta.lastSyncedAt : now,
      },
    },
    hasMore,
  };
}

/**
 * The server's data was restored from a backup (BR-35), so the cached rows may be ones it lost.
 * Only entries with unsent changes stay, and the pull starts over from 0. The changes replay
 * idempotently on the next push.
 */
function restart(state: LocalState, page: PullPage): PullOutcome {
  const pending = new Set([...state.mutations.values()].map((m) => m.transactionId));
  return {
    state: {
      ...state,
      transactions: new Map([...state.transactions].filter(([id]) => pending.has(id))),
      accounts: new Map(),
      categories: new Map(),
      conflicts: new Map(),
      meta: { ...state.meta, cursor: 0, epoch: page.epoch },
    },
    hasMore: true,
  };
}

/**
 * A conflict the server just resolved: it closes here at once and the entry takes the row the
 * server answered with, so this device does not wait for the next pull. A change queued meanwhile
 * now builds on the resolved row; one already sent keeps its frozen base (BR-18).
 */
export function settleConflict(state: LocalState, conflictId: string, row: ServerRow): LocalState {
  const transactions = new Map(state.transactions);
  const pending = mutationsFor(state, row.id);
  applyServerRow(transactions, row, pending.length > 0);
  const mutations = new Map(state.mutations);
  if (!isTombstone(row)) {
    for (const mutation of pending) {
      if (mutation.state.status === 'queued') {
        mutations.set(mutation.mutationId, { ...mutation, baseVersion: row.version });
      }
    }
  }
  return {
    ...state,
    transactions,
    mutations,
    conflicts: withoutEntries(state.conflicts, [conflictId]),
  };
}
