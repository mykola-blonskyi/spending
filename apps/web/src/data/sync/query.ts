import {
  isDeleted,
  type LocalState,
  type LocalTransaction,
  type QueuedMutation,
  queueOrder,
} from './model';

const BASE_CURRENCY = 'EUR';

export type EntrySync =
  | { readonly state: 'synced' }
  | { readonly state: 'pending' }
  | { readonly state: 'failed'; readonly code: string }
  | { readonly state: 'conflict' };

/** An entry as history shows it: the optimistic row while a change is pending, else the server row. */
export type TransactionEntry = LocalTransaction &
  Readonly<{
    scope: 'personal' | 'family';
    /** EUR amount; null until the server has converted it. */
    baseAmountMinor: number | null;
    sync: EntrySync;
  }>;

export type TransactionFilter = Readonly<{
  text?: string;
  /** Inclusive `YYYY-MM-DD` bounds. */
  from?: string;
  to?: string;
  kind?: 'income' | 'expense';
  currency?: string;
  accountId?: string;
  categoryId?: string;
  scope?: 'personal' | 'family';
}>;

/** How each entry stands with the server, from the queue and the open conflicts. */
function syncLookup(state: LocalState): (id: string) => EntrySync {
  const latest = new Map<string, QueuedMutation>();
  for (const mutation of queueOrder(state)) latest.set(mutation.transactionId, mutation);
  const conflicted = new Set([...state.conflicts.values()].map((c) => c.transactionId));
  return (id) => {
    const mutation = latest.get(id);
    if (mutation?.state.status === 'failed') return { state: 'failed', code: mutation.state.code };
    if (mutation) return { state: 'pending' };
    return conflicted.has(id) ? { state: 'conflict' } : { state: 'synced' };
  };
}

/** Every visible entry, each counted once. Pending-review rows stay hidden (BR-21). */
export function localEntries(state: LocalState): TransactionEntry[] {
  const scope = (workspaceId: string) =>
    state.workspaces.get(workspaceId)?.kind === 'family' ? 'family' : 'personal';
  const syncOf = syncLookup(state);
  const entries: TransactionEntry[] = [];
  for (const record of state.transactions.values()) {
    if (isDeleted(record.local)) continue;
    if (record.local) {
      const row = record.local;
      const unchangedAmount =
        record.server?.amountMinor === row.amountMinor && record.server.currency === row.currency;
      entries.push({
        ...row,
        scope: scope(row.workspaceId),
        baseAmountMinor:
          row.currency === BASE_CURRENCY
            ? row.amountMinor
            : unchangedAmount
              ? (record.server?.baseAmountMinor ?? null)
              : null,
        sync: syncOf(record.id),
      });
    } else if (record.server && record.server.reviewStatus === 'confirmed') {
      const row = record.server;
      entries.push({
        id: row.id,
        workspaceId: row.workspaceId,
        kind: row.kind,
        amountMinor: row.amountMinor,
        currency: row.currency,
        occurredOn: row.occurredOn,
        accountId: row.accountId,
        categoryId: row.categoryId,
        description: row.description,
        note: row.note,
        createdAt: row.createdAt,
        scope: row.scope,
        baseAmountMinor: row.baseAmountMinor,
        sync: syncOf(record.id),
      });
    }
  }
  return entries;
}

export function matchesFilter(entry: TransactionEntry, filter: TransactionFilter): boolean {
  if (filter.kind && entry.kind !== filter.kind) return false;
  if (filter.scope && entry.scope !== filter.scope) return false;
  if (filter.currency && entry.currency !== filter.currency) return false;
  if (filter.accountId && entry.accountId !== filter.accountId) return false;
  if (filter.categoryId && entry.categoryId !== filter.categoryId) return false;
  if (filter.from && entry.occurredOn < filter.from) return false;
  if (filter.to && entry.occurredOn > filter.to) return false;
  const text = filter.text?.trim().toLocaleLowerCase();
  if (text) {
    const haystack = `${entry.description}\n${entry.note}`.toLocaleLowerCase();
    if (!haystack.includes(text)) return false;
  }
  return true;
}

/** Newest first: by `occurredOn`, then by creation. */
export function compareEntries(a: TransactionEntry, b: TransactionEntry): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

export function queryTransactions(
  state: LocalState,
  filter: TransactionFilter,
): TransactionEntry[] {
  return localEntries(state)
    .filter((entry) => matchesFilter(entry, filter))
    .sort(compareEntries);
}

export type CurrencyTotals = { income: number; expense: number };

/** Sums per currency in minor units. Entries are already one per transaction, so none counts twice. */
export function totalsByCurrency(
  entries: readonly TransactionEntry[],
): Map<string, CurrencyTotals> {
  const totals = new Map<string, CurrencyTotals>();
  for (const entry of entries) {
    const current = totals.get(entry.currency) ?? { income: 0, expense: 0 };
    current[entry.kind] += entry.amountMinor;
    totals.set(entry.currency, current);
  }
  return totals;
}
