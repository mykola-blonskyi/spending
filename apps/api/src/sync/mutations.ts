import { z } from 'zod';
import type { ErrorCode } from '../common/errors';
import { MEMBER_ROLES, storedName, WORKSPACE_KINDS } from '../workspaces/family';
import {
  accountViewSchema,
  amountMinorSchema,
  calendarDateSchema,
  categoryViewSchema,
  currencySchema,
  DESCRIPTION_MAX,
  ENTRY_KINDS,
  type EntryKind,
  ledgerRowSchema,
  NOTE_MAX,
} from '../ledger/views';
import {
  type AccountFact,
  type CategoryFact,
  referenceError,
  transferError,
  type TransferPeer,
} from '../ledger/rules';

const PUSH_MAX = 200;

export const transactionInputSchema = z.strictObject({
  id: z.uuid(),
  workspaceId: z.uuid(),
  kind: z.enum(ENTRY_KINDS),
  amountMinor: amountMinorSchema,
  currency: currencySchema,
  occurredOn: calendarDateSchema,
  accountId: z.uuid().nullable(),
  categoryId: z.uuid().nullable(),
  description: z.string().max(DESCRIPTION_MAX),
  note: z.string().max(NOTE_MAX),
  // Absent from a client older than transfers (a queued mutation, a tab open across a deploy):
  // the row keeps its mark (BR-37).
  transferId: z.uuid().nullable().optional(),
  transferOutside: z.boolean().optional(),
});
export type TransactionInput = z.infer<typeof transactionInputSchema>;

const upsertMutation = z.strictObject({
  mutationId: z.uuid(),
  type: z.literal('transaction.upsert'),
  baseVersion: z.int().min(1).nullable(),
  transaction: transactionInputSchema,
});
const deleteMutation = z.strictObject({
  mutationId: z.uuid(),
  type: z.literal('transaction.delete'),
  transactionId: z.uuid(),
  baseVersion: z.int().min(1),
});
const mutationSchema = z.discriminatedUnion('type', [upsertMutation, deleteMutation]);
export type Mutation = z.infer<typeof mutationSchema>;

export const pushBodySchema = z.strictObject({
  mutations: z.array(mutationSchema).min(1).max(PUSH_MAX),
});

export const DELETED = { deleted: true } as const;
export const conflictLocalSchema = z.union([
  transactionInputSchema,
  z.strictObject({ deleted: z.literal(true) }),
]);
export type ConflictLocal = z.infer<typeof conflictLocalSchema>;

export const pushResultSchema = z.discriminatedUnion('status', [
  z.object({ mutationId: z.uuid(), status: z.literal('applied'), transaction: ledgerRowSchema }),
  z.object({
    mutationId: z.uuid(),
    status: z.literal('conflict'),
    conflictId: z.uuid(),
    transaction: ledgerRowSchema,
  }),
  z.object({
    mutationId: z.uuid(),
    status: z.literal('rejected'),
    code: z.string(),
    message: z.string(),
  }),
]);
export const pushResponseSchema = z.object({ results: z.array(pushResultSchema) });

export type RejectCode = Extract<
  ErrorCode,
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_ACCOUNT'
  | 'INVALID_CATEGORY'
  | 'INVALID_TRANSFER'
  | 'CURRENCY_MISMATCH'
  | 'REVIEW_REQUIRED'
>;

/** The user-visible fields a client writes, as stored. */
export type IntendedFields = Readonly<{
  workspaceId: string;
  kind: EntryKind;
  amountMinor: number;
  currency: string;
  occurredOn: string;
  accountId: string | null;
  categoryId: string | null;
  description: string;
  note: string;
  transferId: string | null;
  transferOutside: boolean;
}>;

export type ExistingRow = IntendedFields &
  Readonly<{
    createdBy: string | null;
    version: number;
    reviewStatus: 'confirmed' | 'pending_review';
    deletedAt: Date | null;
  }>;

/** BR-19: equal user-visible state means the write would change nothing. */
export function sameIntent(intended: IntendedFields, row: IntendedFields): boolean {
  return (
    intended.workspaceId === row.workspaceId &&
    intended.kind === row.kind &&
    intended.amountMinor === row.amountMinor &&
    intended.currency === row.currency &&
    intended.occurredOn === row.occurredOn &&
    intended.accountId === row.accountId &&
    intended.categoryId === row.categoryId &&
    intended.description === row.description &&
    intended.note === row.note &&
    intended.transferId === row.transferId &&
    intended.transferOutside === row.transferOutside
  );
}

/**
 * A viewer who cannot see the row's account receives `accountId: null` (BR-3). Sending that null
 * back means "unchanged", or editing a family row would silently drop the author's account.
 */
export function effectiveAccountId(
  input: TransactionInput,
  existing: ExistingRow | null,
  existingAccountHidden: boolean,
): string | null {
  if (input.accountId === null && existing && existingAccountHidden) return existing.accountId;
  return input.accountId;
}

export type UpsertFacts = Readonly<{
  actorId: string;
  /** Workspace ids the actor belongs to. */
  workspaces: ReadonlySet<string>;
  intended: IntendedFields;
  baseVersion: number | null;
  existing: ExistingRow | null;
  /** The personal workspace of the row's author (the actor for a new row), if the author exists. */
  authorPersonalWorkspaceId: string | null;
  /** The account `intended.accountId` names, or null when there is none or it does not exist. */
  account: AccountFact | null;
  category: CategoryFact | null;
  /** Other live rows sharing `intended.transferId`. */
  transferPeers: readonly TransferPeer[];
}>;

export type UpsertDecision =
  | { outcome: 'rejected'; code: RejectCode }
  | { outcome: 'unchanged' }
  | { outcome: 'conflict' }
  | { outcome: 'insert' }
  | { outcome: 'update' };

const reject = (code: RejectCode): UpsertDecision => ({ outcome: 'rejected', code });

/** Authorization, conflict detection and reference rules for one upsert (BR-2..4, BR-19). */
export function decideUpsert(facts: UpsertFacts): UpsertDecision {
  const { intended, existing } = facts;
  if (!facts.workspaces.has(intended.workspaceId)) return reject('NOT_FOUND');
  if (existing && !facts.workspaces.has(existing.workspaceId)) return reject('NOT_FOUND');
  if (existing?.reviewStatus === 'pending_review') return reject('REVIEW_REQUIRED');
  if (
    existing &&
    existing.workspaceId !== intended.workspaceId &&
    existing.createdBy !== facts.actorId
  ) {
    return reject('FORBIDDEN');
  }
  const live = existing !== null && existing.deletedAt === null;
  if (existing && facts.baseVersion !== existing.version) {
    return live && sameIntent(intended, existing)
      ? { outcome: 'unchanged' }
      : { outcome: 'conflict' };
  }

  const referenceCode = referenceError({
    ...intended,
    current: existing,
    isAuthor: existing ? existing.createdBy === facts.actorId : true,
    authorPersonalWorkspaceId: facts.authorPersonalWorkspaceId,
    account: facts.account,
    category: facts.category,
  });
  if (referenceCode) return reject(referenceCode);
  const transferCode = transferError(intended, facts.transferPeers);
  if (transferCode) return reject(transferCode);
  if (!existing) return { outcome: 'insert' };
  return live && sameIntent(intended, existing) ? { outcome: 'unchanged' } : { outcome: 'update' };
}

export type DeleteDecision =
  | { outcome: 'rejected'; code: RejectCode }
  | { outcome: 'unchanged' }
  | { outcome: 'conflict' }
  | { outcome: 'delete' };

export function decideDelete(facts: {
  workspaces: ReadonlySet<string>;
  existing: ExistingRow | null;
  baseVersion: number;
}): DeleteDecision {
  const { existing } = facts;
  if (!existing || !facts.workspaces.has(existing.workspaceId)) {
    return { outcome: 'rejected', code: 'NOT_FOUND' };
  }
  if (existing.deletedAt) return { outcome: 'unchanged' };
  if (existing.reviewStatus === 'pending_review') {
    return { outcome: 'rejected', code: 'REVIEW_REQUIRED' };
  }
  if (facts.baseVersion !== existing.version) return { outcome: 'conflict' };
  return { outcome: 'delete' };
}

export type PullWindow = Readonly<{ cutoff: number; hasMore: boolean }>;

/**
 * Accounts, categories, transactions and sync tombstones share one revision sequence. Each source
 * is read with `limit + 1` rows above the cursor, ascending. When a source overflows, rows above
 * its `limit`-th revision are unseen, so the page stops at the smallest such revision across
 * overflowing sources; every row at or below the cutoff has then been read from every source.
 */
export function pullWindow(
  cursor: number,
  limit: number,
  tables: readonly (readonly number[])[],
): PullWindow {
  const overflowing = tables.filter((revisions) => revisions.length > limit);
  if (overflowing.length > 0) {
    return { cutoff: Math.min(...overflowing.map((r) => r[limit - 1]!)), hasMore: true };
  }
  const last = tables.flatMap((revisions) => revisions.slice(-1));
  return { cutoff: Math.max(cursor, ...last), hasMore: false };
}

export const pullQuerySchema = z.strictObject({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const conflictViewSchema = z.object({
  id: z.uuid(),
  transactionId: z.uuid(),
  baseVersion: z.int(),
  serverVersion: z.int(),
  local: conflictLocalSchema,
  server: ledgerRowSchema,
  createdAt: z.iso.datetime(),
});

export const pullResponseSchema = z.object({
  /** Changes when the server's data is restored from a backup; see BR-35. */
  epoch: z.uuid(),
  workspaces: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(WORKSPACE_KINDS),
      name: storedName,
      role: z.enum(MEMBER_ROLES),
    }),
  ),
  accounts: z.array(accountViewSchema),
  categories: z.array(categoryViewSchema),
  transactions: z.array(ledgerRowSchema),
  conflicts: z.array(conflictViewSchema),
  cursor: z.int(),
  hasMore: z.boolean(),
});

export const conflictListSchema = z.object({ conflicts: z.array(conflictViewSchema) });

export const resolveBodySchema = z
  .strictObject({
    resolution: z.enum(['server', 'local', 'merged']),
    transaction: transactionInputSchema.optional(),
  })
  .refine((body) => (body.resolution === 'merged') === (body.transaction !== undefined), {
    message: 'transaction is required for merged and only allowed there',
    path: ['transaction'],
  });

export const resolveResponseSchema = z.object({
  id: z.uuid(),
  status: z.literal('resolved'),
  resolution: z.enum(['server', 'local', 'merged']),
  resolvedAt: z.iso.datetime(),
  transaction: ledgerRowSchema,
});
