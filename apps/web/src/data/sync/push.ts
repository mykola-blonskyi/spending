import {
  type Conflict,
  DELETED,
  isDeleted,
  isTombstone,
  type LocalState,
  mutationsFor,
  type PushResult,
  type QueuedMutation,
  type TransactionRecord,
  withEntry,
  withoutEntries,
} from './model';
import { requeueInFlight } from './queue';

type Settled = {
  record: TransactionRecord | null;
  keep: QueuedMutation[];
  drop: QueuedMutation[];
};

function commitSettled(state: LocalState, id: string, settled: Settled): LocalState {
  const mutations = withoutEntries(
    state.mutations,
    settled.drop.map((mutation) => mutation.mutationId),
  );
  for (const mutation of settled.keep) mutations.set(mutation.mutationId, mutation);
  const transactions = settled.record
    ? withEntry(state.transactions, id, settled.record)
    : withoutEntries(state.transactions, [id]);
  return { ...state, transactions, mutations };
}

function conflictFrom(
  mutation: QueuedMutation,
  result: Extract<PushResult, { status: 'conflict' }>,
  now: string,
): Conflict {
  const server = result.transaction;
  return {
    id: result.conflictId,
    transactionId: mutation.transactionId,
    baseVersion: mutation.baseVersion ?? 0,
    serverVersion: isTombstone(server) ? 0 : server.version,
    local: mutation.change.type === 'transaction.upsert' ? mutation.change.transaction : DELETED,
    server,
    createdAt: now,
  };
}

function applyResult(state: LocalState, result: PushResult, now: string): LocalState {
  const mutation = state.mutations.get(result.mutationId);
  if (!mutation) return state;
  const id = mutation.transactionId;
  const record = state.transactions.get(id) ?? null;
  const followers = mutationsFor(state, id).filter((other) => other.seq > mutation.seq);

  switch (result.status) {
    case 'applied': {
      const row = result.transaction;
      if (isTombstone(row)) {
        return commitSettled(state, id, { record: null, keep: [], drop: [mutation, ...followers] });
      }
      const pending = followers.length > 0;
      return commitSettled(state, id, {
        record: {
          id,
          workspaceId: pending && record ? record.workspaceId : row.workspaceId,
          server: row,
          local: pending ? (record?.local ?? null) : null,
        },
        keep: followers.map((follower) => ({ ...follower, baseVersion: row.version })),
        drop: [mutation],
      });
    }
    case 'conflict': {
      const row = result.transaction;
      const server = isTombstone(row) ? null : row;
      const unsendable = (other: QueuedMutation) =>
        other.change.type === 'transaction.delete' && other.baseVersion === null;
      const keep = followers.filter((other) => !unsendable(other));
      const local = keep.length > 0 ? (record?.local ?? null) : null;
      const next = commitSettled(state, id, {
        record: server || local ? { id, workspaceId: row.workspaceId, server, local } : null,
        keep,
        drop: [mutation, ...followers.filter(unsendable)],
      });
      return {
        ...next,
        conflicts: withEntry(
          next.conflicts,
          result.conflictId,
          conflictFrom(mutation, result, now),
        ),
      };
    }
    case 'rejected': {
      if (followers.length === 0) {
        const failed: QueuedMutation = {
          ...mutation,
          state: { status: 'failed', code: result.code, message: result.message },
        };
        return commitSettled(state, id, { record, keep: [failed], drop: [] });
      }
      // A later change supersedes the rejected one; if that change deleted a row the server never
      // had, nothing is left to send.
      if (record && record.server === null && isDeleted(record.local)) {
        return commitSettled(state, id, { record: null, keep: [], drop: [mutation, ...followers] });
      }
      return commitSettled(state, id, { record, keep: [], drop: [mutation] });
    }
  }
}

/**
 * Applies push results in order. Applied: the server row replaces the overlay. Conflict: the
 * server row stays canonical and the conflict is stored. Rejected: the overlay stays and the
 * mutation is marked failed with its code. Anything of the batch `sent` left without a result
 * is frozen for a replay.
 */
export function reducePush(
  state: LocalState,
  results: readonly PushResult[],
  now: string,
  sent: readonly string[],
): LocalState {
  return requeueInFlight(applyPushResults(state, results, now), 'retrying', sent);
}

/** Applies the results of a push cut short, leaving the rest `sending` for the flusher to settle. */
export function applyPushResults(
  state: LocalState,
  results: readonly PushResult[],
  now: string,
): LocalState {
  return results.reduce((current, result) => applyResult(current, result, now), state);
}
