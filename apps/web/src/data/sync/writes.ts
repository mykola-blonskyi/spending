import { isDeleted, type Resolution, type TransactionInput } from './model';
import { settleConflict } from './pull';
import { discardFailed } from './push';
import { applyLocalChange } from './queue';
import type { LocalStore } from './store';
import {
  deleteEntry,
  editEntry,
  markTransfer as markSides,
  unmarkTransfer as unmarkSides,
} from './transfer';
import { postResolution } from './transport';

export type TransactionDraft = Omit<TransactionInput, 'id'>;

const newId = () => crypto.randomUUID();

/** Records a new entry locally and queues it; resolves with its ID once both are on disk. */
export async function recordTransaction(
  store: LocalStore,
  draft: TransactionDraft,
  now: Date = new Date(),
): Promise<string> {
  const id = newId();
  const row = { ...draft, id, createdAt: now.toISOString() };
  await store.commit((state) => applyLocalChange(state, { type: 'upsert', row }, newId));
  return id;
}

export async function updateTransaction(
  store: LocalStore,
  id: string,
  draft: TransactionDraft,
  editedVersion: number | null = null,
): Promise<void> {
  const record = store.state.transactions.get(id);
  const local = record?.local ?? null;
  const current = isDeleted(local) ? null : (local ?? record?.server);
  if (!current) throw new Error(`Transaction ${id} is not on this device`);
  const row = { ...draft, id, createdAt: current.createdAt };
  await store.commit((state) => editEntry(state, row, editedVersion, newId));
}

/** Deletes the entry, and with it the other side of its transfer, in one local commit. */
export async function deleteTransaction(store: LocalStore, id: string): Promise<void> {
  await store.commit((state) => deleteEntry(state, id, newId));
}

/** Both sides change in one local commit (BR-37). `counterpartId` null: an own account outside the app. */
export async function markTransfer(
  store: LocalStore,
  id: string,
  counterpartId: string | null,
): Promise<void> {
  const transferId = newId();
  await store.commit((state) => markSides(state, id, counterpartId, transferId, newId));
}

export async function unmarkTransfer(store: LocalStore, id: string): Promise<void> {
  await store.commit((state) => unmarkSides(state, id, newId));
}

/** Drops an entry's rejected change, back to its last server row or gone if it never synced. */
export async function discardChange(store: LocalStore, id: string): Promise<void> {
  await store.commit((state) => discardFailed(state, id));
}

/** Resolves a conflict on the server (online only), then closes it on this device. */
export async function resolveConflict(
  store: LocalStore,
  conflictId: string,
  resolution: Resolution,
): Promise<void> {
  const row = await postResolution(conflictId, resolution);
  await store.commit((state) => settleConflict(state, conflictId, row));
}
