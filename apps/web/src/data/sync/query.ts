import {
  type Account,
  isDeleted,
  type LocalState,
  type LocalTransaction,
  type QueuedMutation,
  queueOrder,
  type ServerTransaction,
  type TransactionRecord,
} from './model';

const BASE_CURRENCY = 'EUR';

export type Fx = NonNullable<ServerTransaction['fx']>;

export type EntrySync =
  | { readonly state: 'synced' }
  | { readonly state: 'pending' }
  | { readonly state: 'failed'; readonly code: string }
  | { readonly state: 'conflict' };

/** An entry as history shows it: the optimistic row while a change is pending, else the server row. */
export type TransactionEntry = LocalTransaction &
  Readonly<{
    scope: 'personal' | 'family';
    /** The server version shown; null while a local change is pending, which carries its own base. */
    version: number | null;
    /** Who recorded it, as the server last reported; null for a row this device created. */
    author: ServerTransaction['author'] | null;
    /** EUR amount; null until the server has converted it. */
    baseAmountMinor: number | null;
    /** The rate behind `baseAmountMinor`; null for EUR and for unconverted rows. */
    fx: Fx | null;
    sync: EntrySync;
  }>;

export type TransactionFilter = Readonly<{
  text?: string;
  /** Category display names by id, so `text` also matches the category as the user sees it. */
  categoryNames?: ReadonlyMap<string, string>;
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
    const sync = syncOf(record.id);
    // A rejected delete shows the server row as failed, so the user can discard the delete.
    if (isDeleted(record.local) && sync.state !== 'failed') continue;
    if (record.local && !isDeleted(record.local)) {
      const row = record.local;
      // The rate depends on the date (BR-14), so a changed date drops it like a changed amount.
      const server =
        record.server?.amountMinor === row.amountMinor &&
        record.server.currency === row.currency &&
        record.server.occurredOn === row.occurredOn
          ? record.server
          : null;
      entries.push({
        ...row,
        scope: scope(row.workspaceId),
        version: null,
        author: record.server?.author ?? null,
        baseAmountMinor:
          row.currency === BASE_CURRENCY ? row.amountMinor : (server?.baseAmountMinor ?? null),
        fx: row.currency === BASE_CURRENCY ? null : (server?.fx ?? null),
        sync,
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
        transferId: row.transferId,
        transferOutside: row.transferOutside,
        createdAt: row.createdAt,
        scope: row.scope,
        version: row.version,
        author: row.author,
        baseAmountMinor: row.baseAmountMinor,
        fx: row.fx,
        sync,
      });
    }
  }
  return entries;
}

function matchesFilter(entry: TransactionEntry, filter: TransactionFilter): boolean {
  if (filter.kind && entry.kind !== filter.kind) return false;
  if (filter.scope && entry.scope !== filter.scope) return false;
  if (filter.currency && entry.currency !== filter.currency) return false;
  if (filter.accountId && entry.accountId !== filter.accountId) return false;
  if (filter.categoryId && entry.categoryId !== filter.categoryId) return false;
  if (filter.from && entry.occurredOn < filter.from) return false;
  if (filter.to && entry.occurredOn > filter.to) return false;
  const text = filter.text?.trim().toLocaleLowerCase();
  if (text) {
    const category = (entry.categoryId && filter.categoryNames?.get(entry.categoryId)) ?? '';
    const haystack = `${entry.description}\n${entry.note}\n${category}`.toLocaleLowerCase();
    if (!haystack.includes(text)) return false;
  }
  return true;
}

/** Newest first: by `occurredOn`, then by creation. */
function compareEntries(a: TransactionEntry, b: TransactionEntry): number {
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

export type AccountBalance = Readonly<{ balanceMinor: number; uncounted: number }>;

/**
 * BR-40: the opening balance plus the signed sum of the account's live entries from the opening
 * date on (every entry without a date), rows awaiting review and transfer sides included. Older
 * ones are only tallied.
 */
export function accountBalance(
  account: Pick<Account, 'id' | 'openingBalanceMinor' | 'openingOn'>,
  records: Iterable<TransactionRecord>,
): AccountBalance {
  let balanceMinor = account.openingBalanceMinor;
  let uncounted = 0;
  for (const record of records) {
    if (isDeleted(record.local)) continue;
    const row = record.local ?? record.server;
    if (row?.accountId !== account.id) continue;
    if (account.openingOn !== null && row.occurredOn < account.openingOn) uncounted += 1;
    else balanceMinor += row.kind === 'income' ? row.amountMinor : -row.amountMinor;
  }
  return { balanceMinor, uncounted };
}

/**
 * The opening balance and date that make the account show `targetMinor` (BR-40). An account with
 * no opening date starts at its earliest live entry (today when it has none), so no entry drops
 * out of the balance. A zero balance clears the date.
 */
export function openingForBalance(
  account: Pick<Account, 'id' | 'openingOn'>,
  records: Iterable<TransactionRecord>,
  targetMinor: number,
  today: string,
): Pick<Account, 'openingBalanceMinor' | 'openingOn'> {
  const live = [...records];
  let openingOn = account.openingOn ?? today;
  if (account.openingOn === null) {
    for (const record of live) {
      if (isDeleted(record.local)) continue;
      const row = record.local ?? record.server;
      if (row?.accountId === account.id && row.occurredOn < openingOn) openingOn = row.occurredOn;
    }
  }
  const entries = accountBalance({ id: account.id, openingBalanceMinor: 0, openingOn }, live);
  const openingBalanceMinor = targetMinor - entries.balanceMinor;
  return { openingBalanceMinor, openingOn: openingBalanceMinor === 0 ? null : openingOn };
}
