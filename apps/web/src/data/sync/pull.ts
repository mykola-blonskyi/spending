import {
  isTombstone,
  type LocalState,
  type PullPage,
  type ServerRow,
  type TransactionRecord,
  withoutEntries,
} from './model';

export type PullOutcome = Readonly<{ state: LocalState; hasMore: boolean }>;

function upsertAll<V extends { id: string; workspaceId: string }>(
  current: ReadonlyMap<string, V>,
  rows: readonly V[],
  removedWorkspaces: ReadonlySet<string>,
): Map<string, V> {
  const next = new Map(current);
  for (const row of rows) next.set(row.id, row);
  for (const [id, row] of next) if (removedWorkspaces.has(row.workspaceId)) next.delete(id);
  return next;
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
 * Workspaces (BR-17): rows of a workspace that disappeared are dropped, except entries with
 * pending changes, which stay queued so the push surfaces the loss. A workspace that appeared after
 * the first sync holds rows older than the cursor, so the cursor goes back to 0.
 */
export function reducePull(state: LocalState, page: PullPage, now: string): PullOutcome {
  const workspaces = new Map(page.workspaces.map((workspace) => [workspace.id, workspace]));
  const removed = new Set([...state.workspaces.keys()].filter((id) => !workspaces.has(id)));
  const joined =
    state.workspaces.size > 0 && page.workspaces.some((w) => !state.workspaces.has(w.id));
  const pending = new Set([...state.mutations.values()].map((m) => m.transactionId));

  const transactions = new Map(state.transactions);
  for (const row of page.transactions) applyServerRow(transactions, row, pending.has(row.id));
  for (const [id, record] of transactions) {
    if (removed.has(record.workspaceId) && !pending.has(id)) transactions.delete(id);
  }

  const hasMore = joined || page.hasMore;
  return {
    state: {
      ...state,
      transactions,
      accounts: upsertAll(state.accounts, page.accounts, removed),
      categories: upsertAll(state.categories, page.categories, removed),
      workspaces,
      conflicts: new Map(page.conflicts.map((conflict) => [conflict.id, conflict])),
      meta: {
        ...state.meta,
        cursor: joined ? 0 : page.cursor,
        lastSyncedAt: hasMore ? state.meta.lastSyncedAt : now,
      },
    },
    hasMore,
  };
}

/**
 * A conflict the server just resolved: it closes here at once and the entry takes the row the
 * server answered with, so this device does not wait for the next pull.
 */
export function settleConflict(state: LocalState, conflictId: string, row: ServerRow): LocalState {
  const transactions = new Map(state.transactions);
  const pending = [...state.mutations.values()].some((m) => m.transactionId === row.id);
  applyServerRow(transactions, row, pending);
  return { ...state, transactions, conflicts: withoutEntries(state.conflicts, [conflictId]) };
}
