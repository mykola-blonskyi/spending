import { type Conflict, isTombstone, type TransactionInput } from '@data/sync';

/** What the review compares; amount and currency travel together. */
export const CONFLICT_FIELDS = [
  'kind',
  'amount',
  'occurredOn',
  'categoryId',
  'accountId',
  'workspaceId',
  'description',
  'note',
] as const;

export type ConflictField = (typeof CONFLICT_FIELDS)[number];
export type Side = 'server' | 'local';

const KEYS: Record<ConflictField, readonly (keyof TransactionInput)[]> = {
  kind: ['kind'],
  amount: ['amountMinor', 'currency'],
  occurredOn: ['occurredOn'],
  categoryId: ['categoryId'],
  accountId: ['accountId'],
  workspaceId: ['workspaceId'],
  description: ['description'],
  note: ['note'],
};

/** The two versions of a conflicting entry; null is a deletion. */
export type Versions = Readonly<Record<Side, TransactionInput | null>>;

export function versionsOf(conflict: Conflict): Versions {
  const { server, local } = conflict;
  return {
    server: isTombstone(server)
      ? null
      : {
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
        },
    local: 'deleted' in local ? null : local,
  };
}

/** Fields whose values differ; empty when one side is a deletion, which differs as a whole. */
export function differingFields({ server, local }: Versions): ConflictField[] {
  if (!server || !local) return [];
  return CONFLICT_FIELDS.filter((field) => KEYS[field].some((key) => server[key] !== local[key]));
}

/** The server version with each picked field taken from the chosen side. */
export function mergeVersions(
  server: TransactionInput,
  local: TransactionInput,
  picks: Partial<Record<ConflictField, Side>>,
): TransactionInput {
  const merged = { ...server };
  for (const field of CONFLICT_FIELDS) {
    if (picks[field] !== 'local') continue;
    for (const key of KEYS[field]) Object.assign(merged, { [key]: local[key] });
  }
  return merged;
}
