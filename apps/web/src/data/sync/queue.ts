import {
  DELETED,
  isDeleted,
  type LocalState,
  type LocalTransaction,
  type MutationChange,
  type MutationState,
  mutationsFor,
  type QueuedMutation,
  queueOrder,
  type TransactionInput,
  type TransactionRecord,
  withEntry,
  withoutEntries,
} from './model';

const PUSH_LIMIT = 200;

/** Twice the transport timeout: a mutation `sending` longer than this lost its flush with its tab. */
export const SENDING_STALE_MS = 60_000;

export type LocalChange =
  | {
      readonly type: 'upsert';
      readonly row: LocalTransaction;
      /** The server version the user started editing from, when it was the row on screen. */
      readonly editedVersion?: number | null;
    }
  | { readonly type: 'delete'; readonly id: string };

function inputOf(row: LocalTransaction): TransactionInput {
  const { createdAt: _createdAt, ...input } = row;
  return input;
}

/**
 * Applies a local change to the overlay and the queue together (ADR-006). A change to an entry
 * whose latest mutation is still queued replaces that mutation's payload and keeps its ID and base
 * version. A mutation already sent is never touched: the change queues behind it. A delete of an
 * entry the server has never confirmed, with nothing on its way, forgets the entry entirely.
 */
export function applyLocalChange(
  state: LocalState,
  change: LocalChange,
  newMutationId: () => string,
): LocalState {
  const id = change.type === 'upsert' ? change.row.id : change.id;
  const record = state.transactions.get(id);
  const pending = mutationsFor(state, id);
  const latest = pending.at(-1);

  if (change.type === 'delete') {
    if (!record || isDeleted(record.local)) return state;
    const inFlight = pending.some(
      (mutation) => mutation.state.status === 'sending' || mutation.state.status === 'retrying',
    );
    if (record.server === null && !inFlight) {
      return {
        ...state,
        transactions: withoutEntries(state.transactions, [id]),
        mutations: withoutEntries(
          state.mutations,
          pending.map((mutation) => mutation.mutationId),
        ),
      };
    }
  }

  const mutationChange: MutationChange =
    change.type === 'upsert'
      ? { type: 'transaction.upsert', transaction: inputOf(change.row) }
      : { type: 'transaction.delete' };
  const nextRecord: TransactionRecord =
    change.type === 'upsert'
      ? {
          id,
          workspaceId: change.row.workspaceId,
          server: record?.server ?? null,
          local: change.row,
        }
      : { ...record!, local: DELETED };

  let mutations: Map<string, QueuedMutation>;
  let meta = state.meta;
  if (latest?.state.status === 'queued') {
    mutations = withEntry(state.mutations, latest.mutationId, {
      ...latest,
      change: mutationChange,
    });
  } else {
    const fresh: QueuedMutation = {
      mutationId: newMutationId(),
      seq: meta.nextSeq,
      transactionId: id,
      baseVersion: latest
        ? latest.baseVersion
        : ((change.type === 'upsert' ? change.editedVersion : null) ??
          record?.server?.version ??
          null),
      change: mutationChange,
      state: { status: 'queued' },
    };
    // A rejected mutation's outcome is stored on the server under its ID, so a fix needs a new one.
    mutations =
      latest?.state.status === 'failed'
        ? withoutEntries(state.mutations, [latest.mutationId])
        : new Map(state.mutations);
    mutations.set(fresh.mutationId, fresh);
    meta = { ...meta, nextSeq: meta.nextSeq + 1 };
  }

  return { ...state, transactions: withEntry(state.transactions, id, nextRecord), mutations, meta };
}

/**
 * The next mutations to push, in queue order. A batch holds at most one mutation per entry: a
 * later change to the same entry waits until the earlier one's result has rebased it.
 */
export function selectBatch(state: LocalState, limit: number = PUSH_LIMIT): QueuedMutation[] {
  const seen = new Set<string>();
  const batch: QueuedMutation[] = [];
  for (const mutation of queueOrder(state)) {
    if (batch.length === limit) break;
    if (seen.has(mutation.transactionId)) continue;
    seen.add(mutation.transactionId);
    if (mutation.state.status === 'queued' || mutation.state.status === 'retrying') {
      batch.push(mutation);
    }
  }
  return batch;
}

export function setMutationState(
  state: LocalState,
  mutationIds: readonly string[],
  next: MutationState,
): LocalState {
  const mutations = new Map(state.mutations);
  for (const id of mutationIds) {
    const mutation = mutations.get(id);
    if (mutation) mutations.set(id, { ...mutation, state: next });
  }
  return { ...state, mutations };
}

/**
 * Settles mutations left `sending`. By default the push may have reached the server, so they are
 * frozen for a replay (BR-18); `queued` is for a push known to have changed nothing. `only` limits
 * this to one flush's batch, so another tab's push in flight is left alone.
 */
export function requeueInFlight(
  state: LocalState,
  status: 'queued' | 'retrying' = 'retrying',
  only?: readonly string[],
): LocalState {
  const sending = [...state.mutations.values()]
    .filter((mutation) => mutation.state.status === 'sending')
    .filter((mutation) => !only || only.includes(mutation.mutationId))
    .map((mutation) => mutation.mutationId);
  return sending.length === 0 ? state : setMutationState(state, sending, { status });
}

/** Mutations whose flush died with its tab; a younger `sending` one may be another tab's push. */
export function staleSending(state: LocalState, now: number): string[] {
  return [...state.mutations.values()]
    .filter(
      (mutation) =>
        mutation.state.status === 'sending' &&
        // A row stored before `since` existed parses to NaN and counts as stale.
        !(now - Date.parse(mutation.state.since) < SENDING_STALE_MS),
    )
    .map((mutation) => mutation.mutationId);
}

export function countMutations(state: LocalState): { pending: number; failed: number } {
  let pending = 0;
  let failed = 0;
  for (const mutation of state.mutations.values()) {
    if (mutation.state.status === 'failed') failed += 1;
    else pending += 1;
  }
  return { pending, failed };
}
