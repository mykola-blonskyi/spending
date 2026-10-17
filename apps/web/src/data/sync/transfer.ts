import { isDeleted, type LocalState, type LocalTransaction } from './model';
import { applyLocalChange } from './queue';

/** The row an entry shows now: its pending change, else its server row. */
function currentRow(state: LocalState, id: string): LocalTransaction | null {
  const record = state.transactions.get(id);
  if (!record || isDeleted(record.local)) return null;
  if (record.local) return record.local;
  const server = record.server;
  if (!server) return null;
  return {
    id: server.id,
    workspaceId: server.workspaceId,
    kind: server.kind,
    amountMinor: server.amountMinor,
    currency: server.currency,
    occurredOn: server.occurredOn,
    accountId: server.accountId,
    categoryId: server.categoryId,
    description: server.description,
    note: server.note,
    transferId: server.transferId,
    transferOutside: server.transferOutside,
    createdAt: server.createdAt,
  };
}

function setSides(
  state: LocalState,
  ids: readonly string[],
  patch: Pick<LocalTransaction, 'transferId' | 'transferOutside'>,
  newMutationId: () => string,
): LocalState {
  return ids.reduce((next, id) => {
    const row = currentRow(next, id);
    if (!row) throw new Error(`Transaction ${id} is not on this device`);
    // A transfer is neither income nor spending, and unmarking asks for a category again (BR-37).
    const change = { type: 'upsert' as const, row: { ...row, ...patch, categoryId: null } };
    return applyLocalChange(next, change, newMutationId);
  }, state);
}

/**
 * Marks `id` and `counterpartId` as the two sides of one transfer, or `id` alone as a transfer
 * to or from an own account outside the app when `counterpartId` is null. Each side is an
 * ordinary queued upsert, so offline, retries and conflicts work as for any edit.
 */
export function markTransfer(
  state: LocalState,
  id: string,
  counterpartId: string | null,
  transferId: string,
  newMutationId: () => string,
): LocalState {
  const ids = counterpartId ? [id, counterpartId] : [id];
  return setSides(state, ids, { transferId, transferOutside: !counterpartId }, newMutationId);
}

/** Turns every side of the entry's transfer back into income or expense awaiting a category. */
export function unmarkTransfer(
  state: LocalState,
  id: string,
  newMutationId: () => string,
): LocalState {
  const transferId = currentRow(state, id)?.transferId;
  if (!transferId) return state;
  const sides = [...state.transactions.keys()].filter(
    (other) => currentRow(state, other)?.transferId === transferId,
  );
  return setSides(state, sides, { transferId: null, transferOutside: false }, newMutationId);
}
