import { z } from 'zod';
import { isCalendarDate } from '../common/dates';
import { parseCurrency } from '../common/money';
import { storedName, WORKSPACE_KINDS, type WorkspaceKind } from '../workspaces/family';

const ACCOUNT_KINDS = ['cash', 'bank', 'card', 'savings', 'other'] as const;
export const ENTRY_KINDS = ['income', 'expense'] as const;
const TRANSACTION_SOURCES = ['manual', 'import', 'recurring'] as const;
const REVIEW_STATUSES = ['confirmed', 'pending_review'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

const timestamp = z.iso.datetime();
// Named, because nestjs-zod renders a nullable top-level DTO property as an array.
const archivedAt = timestamp.nullable().meta({ id: 'ArchivedAt' });
const systemKey = z.string().nullable().meta({ id: 'SystemKey' });

export const currencySchema = z
  .string()
  .refine((value) => parseCurrency(value) !== null, 'unknown ISO 4217 currency');

/** BR-13: a ceiling far below 2^53, so sums and conversions stay safe integers. */
export const AMOUNT_MINOR_MAX = 1_000_000_000_000;
export const amountMinorSchema = z.int().positive().max(AMOUNT_MINOR_MAX);
/** Entry text limits; the web app keeps equal copies (common/money.test.ts). */
export const DESCRIPTION_MAX = 200;
export const NOTE_MAX = 2000;

export const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, 'must be a YYYY-MM-DD calendar date')
  .refine((value) => value >= '1970-01-01' && value <= '2100-12-31', 'out of range');

const name = z.string().trim().min(1).max(60);
/** BR-40: may be negative, within the amount ceiling. */
const openingBalanceMinor = z.int().min(-AMOUNT_MINOR_MAX).max(AMOUNT_MINOR_MAX);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const icon = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const accountViewSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string(),
  kind: z.enum(ACCOUNT_KINDS),
  currency: z.string(),
  openingBalanceMinor: z.int(),
  openingOn: z.string(),
  archivedAt,
  revision: z.int(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type AccountView = z.infer<typeof accountViewSchema>;

export const categoryViewSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: storedName,
  kind: z.enum(ENTRY_KINDS),
  color: z.string(),
  icon: z.string(),
  systemKey,
  archivedAt,
  revision: z.int(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type CategoryView = z.infer<typeof categoryViewSchema>;

export const createAccountSchema = z.strictObject({
  workspaceId: z.uuid(),
  name,
  kind: z.enum(ACCOUNT_KINDS),
  currency: currencySchema,
  openingBalanceMinor: openingBalanceMinor.optional(),
  openingOn: calendarDateSchema.optional(),
});
export const updateAccountSchema = z.strictObject({
  name: name.optional(),
  kind: z.enum(ACCOUNT_KINDS).optional(),
  openingBalanceMinor: openingBalanceMinor.optional(),
  openingOn: calendarDateSchema.optional(),
  archived: z.boolean().optional(),
});
export const createCategorySchema = z.strictObject({
  workspaceId: z.uuid(),
  name,
  kind: z.enum(ENTRY_KINDS),
  color: color.transform((value) => value.toLowerCase()),
  icon,
});
export const updateCategorySchema = z.strictObject({
  /** `null` returns a default category to its localized name. */
  name: name.nullable().optional(),
  color: color.transform((value) => value.toLowerCase()).optional(),
  icon: icon.optional(),
  archived: z.boolean().optional(),
});
export const workspaceFilterSchema = z.strictObject({ workspaceId: z.uuid().optional() });

export const transactionViewSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    scope: z.enum(WORKSPACE_KINDS),
    kind: z.enum(ENTRY_KINDS),
    amountMinor: z.int(),
    currency: z.string(),
    baseAmountMinor: z.int().nullable(),
    fx: z.object({ rate: z.string(), rateDate: z.string(), source: z.string() }).nullable(),
    occurredOn: z.string(),
    accountId: z.uuid().nullable(),
    categoryId: z.uuid().nullable(),
    description: z.string(),
    note: z.string(),
    source: z.enum(TRANSACTION_SOURCES),
    reviewStatus: z.enum(REVIEW_STATUSES),
    importBatchId: z.uuid().nullable(),
    /** Both sides of a transfer share it; null for ordinary income and expense (BR-37). */
    transferId: z.uuid().nullable(),
    /** A one-sided transfer: the other side is an own account outside the app. */
    transferOutside: z.boolean(),
    author: z.object({ userId: z.uuid().nullable(), displayName: z.string().nullable() }),
    version: z.int(),
    revision: z.int(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .meta({ id: 'TransactionView' });
export type TransactionView = z.infer<typeof transactionViewSchema>;

const tombstoneSchema = z
  .object({ id: z.uuid(), workspaceId: z.uuid(), deletedAt: timestamp, revision: z.int() })
  .meta({ id: 'Tombstone' });
export type Tombstone = z.infer<typeof tombstoneSchema>;

export const ledgerRowSchema = z.union([transactionViewSchema, tombstoneSchema]);
export type LedgerRow = TransactionView | Tombstone;

/** A transaction joined with what its view needs: workspace kind, author, account workspace. */
export type TransactionViewRow = Readonly<{
  id: string;
  workspaceId: string;
  workspaceKind: WorkspaceKind;
  kind: EntryKind;
  amountMinor: number;
  currency: string;
  baseAmountMinor: number | null;
  fxRate: string | null;
  fxRateDate: string | null;
  fxSource: string | null;
  occurredOn: string;
  accountId: string | null;
  accountWorkspaceId: string | null;
  categoryId: string | null;
  description: string;
  note: string;
  source: (typeof TRANSACTION_SOURCES)[number];
  reviewStatus: (typeof REVIEW_STATUSES)[number];
  importBatchId: string | null;
  transferId: string | null;
  transferOutside: boolean;
  createdBy: string | null;
  authorName: string | null;
  version: number;
  revision: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

/**
 * The one shape every reader gets (REST, sync, export). `visible` is the viewer's workspace ids:
 * an account outside them reads as null (BR-3), and a deleted row is only a tombstone (BR-16).
 */
export function toLedgerRow(row: TransactionViewRow, visible: ReadonlySet<string>): LedgerRow {
  if (row.deletedAt) {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      deletedAt: row.deletedAt.toISOString(),
      revision: row.revision,
    };
  }
  const accountVisible = row.accountWorkspaceId !== null && visible.has(row.accountWorkspaceId);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    scope: row.workspaceKind,
    kind: row.kind,
    amountMinor: row.amountMinor,
    currency: row.currency,
    baseAmountMinor: row.baseAmountMinor,
    fx:
      row.fxRate && row.fxRateDate && row.fxSource
        ? { rate: row.fxRate, rateDate: row.fxRateDate, source: row.fxSource }
        : null,
    occurredOn: row.occurredOn,
    accountId: accountVisible ? row.accountId : null,
    categoryId: row.categoryId,
    description: row.description,
    note: row.note,
    source: row.source,
    reviewStatus: row.reviewStatus,
    importBatchId: row.importBatchId,
    transferId: row.transferId,
    transferOutside: row.transferOutside,
    author: { userId: row.createdBy, displayName: row.authorName },
    version: row.version,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type Dated = { archivedAt: Date | null; createdAt: Date; updatedAt: Date };
/** Serves accounts and categories alike: their dated columns are the only ones that need converting. */
export const toView = <T extends Dated>(row: T) => ({
  ...row,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
