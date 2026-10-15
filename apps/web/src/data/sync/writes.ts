import { isDeleted, type TransactionInput } from './model';
import { applyLocalChange, type LocalChange } from './queue';
import type { LocalStore } from './store';

export type TransactionDraft = Omit<TransactionInput, 'id'>;

const newId = () => crypto.randomUUID();

function write(store: LocalStore, change: LocalChange) {
  return store.commit((state) => applyLocalChange(state, change, newId));
}

/** Records a new entry locally and queues it; resolves with its ID once both are on disk. */
export async function recordTransaction(
  store: LocalStore,
  draft: TransactionDraft,
  now: Date = new Date(),
): Promise<string> {
  const id = newId();
  await write(store, { type: 'upsert', row: { ...draft, id, createdAt: now.toISOString() } });
  return id;
}

export async function updateTransaction(
  store: LocalStore,
  id: string,
  draft: TransactionDraft,
): Promise<void> {
  const record = store.state.transactions.get(id);
  const local = record?.local ?? null;
  const current = isDeleted(local) ? null : (local ?? record?.server);
  if (!current) throw new Error(`Transaction ${id} is not on this device`);
  await write(store, { type: 'upsert', row: { ...draft, id, createdAt: current.createdAt } });
}

export async function deleteTransaction(store: LocalStore, id: string): Promise<void> {
  await write(store, { type: 'delete', id });
}
