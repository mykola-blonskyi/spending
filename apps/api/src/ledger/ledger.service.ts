import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, ne, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { ApiError } from '../common/errors';
import {
  DB,
  type Db,
  isUniqueViolation,
  ledgerTransaction,
  type Tx,
} from '../database/database.module';
import { accounts, categories, transactions, users, workspaces } from '../database/schema';
import { AccessPolicy } from '../workspaces/access-policy';
import {
  type AccountView,
  type CategoryView,
  createAccountSchema,
  createCategorySchema,
  type LedgerRow,
  toView,
  toLedgerRow,
  updateAccountSchema,
  updateCategorySchema,
} from './views';

type CreateAccount = z.infer<typeof createAccountSchema>;
type UpdateAccount = z.infer<typeof updateAccountSchema>;
type CreateCategory = z.infer<typeof createCategorySchema>;
type UpdateCategory = z.infer<typeof updateCategorySchema>;

export const accountColumns = {
  id: accounts.id,
  workspaceId: accounts.workspaceId,
  name: accounts.name,
  kind: accounts.kind,
  currency: accounts.currency,
  openingBalanceMinor: accounts.openingBalanceMinor,
  openingOn: accounts.openingOn,
  archivedAt: accounts.archivedAt,
  revision: accounts.revision,
  createdAt: accounts.createdAt,
  updatedAt: accounts.updatedAt,
};

export const categoryColumns = {
  id: categories.id,
  workspaceId: categories.workspaceId,
  name: categories.name,
  kind: categories.kind,
  color: categories.color,
  icon: categories.icon,
  systemKey: categories.systemKey,
  archivedAt: categories.archivedAt,
  revision: categories.revision,
  createdAt: categories.createdAt,
  updatedAt: categories.updatedAt,
};

const viewColumns = {
  id: transactions.id,
  workspaceId: transactions.workspaceId,
  workspaceKind: workspaces.kind,
  kind: transactions.kind,
  amountMinor: transactions.amountMinor,
  currency: transactions.currency,
  baseAmountMinor: transactions.baseAmountMinor,
  fxRate: transactions.fxRate,
  fxRateDate: transactions.fxRateDate,
  fxSource: transactions.fxSource,
  occurredOn: transactions.occurredOn,
  accountId: transactions.accountId,
  accountWorkspaceId: accounts.workspaceId,
  categoryId: transactions.categoryId,
  description: transactions.description,
  note: transactions.note,
  source: transactions.source,
  reviewStatus: transactions.reviewStatus,
  importBatchId: transactions.importBatchId,
  transferId: transactions.transferId,
  transferOutside: transactions.transferOutside,
  createdBy: transactions.createdBy,
  authorName: users.displayName,
  version: transactions.version,
  revision: transactions.revision,
  deletedAt: transactions.deletedAt,
  createdAt: transactions.createdAt,
  updatedAt: transactions.updatedAt,
};

/**
 * BR-37. A live side of one of these transfers left without a live partner becomes one-sided.
 * The caller holds the ledger lock and passes the transfers a write took a side out of.
 */
export async function releaseLoneSides(tx: Tx, transferIds: readonly string[]): Promise<void> {
  if (transferIds.length === 0) return;
  const peer = alias(transactions, 'peer');
  await tx
    .update(transactions)
    .set({ transferOutside: true })
    .where(
      and(
        inArray(transactions.transferId, [...transferIds]),
        isNull(transactions.deletedAt),
        eq(transactions.transferOutside, false),
        notExists(
          tx
            .select({ id: peer.id })
            .from(peer)
            .where(
              and(
                eq(peer.transferId, transactions.transferId),
                ne(peer.id, transactions.id),
                isNull(peer.deletedAt),
              ),
            ),
        ),
      ),
    );
}

/** Transactions joined with what `toLedgerRow` needs. Callers add the workspace constraint. */
export function selectViewRows(tx: Tx) {
  return tx
    .select(viewColumns)
    .from(transactions)
    .innerJoin(workspaces, eq(workspaces.id, transactions.workspaceId))
    .leftJoin(users, eq(users.id, transactions.createdBy))
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .$dynamic();
}

const archivedPatch = (archived: boolean | undefined) =>
  archived === undefined ? {} : { archivedAt: archived ? sql`now()` : null };

/**
 * Only the fields and archive state that differ from `current`. An empty result means the PATCH
 * is a no-op and must not write, since every write takes a new revision that clients re-pull.
 */
function changes<T extends { archived?: boolean }>(
  current: { archivedAt: Date | null } & Record<string, unknown>,
  patch: T,
): Partial<T> {
  const changed = Object.entries(patch).filter(([key, value]) =>
    key === 'archived' ? value !== (current.archivedAt !== null) : value !== current[key],
  );
  return Object.fromEntries(changed) as Partial<T>;
}

@Injectable()
export class LedgerService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AccessPolicy) private readonly policy: AccessPolicy,
  ) {}

  async listAccounts(actorId: string, workspaceId?: string): Promise<AccountView[]> {
    const ids = (await this.policy.scope(actorId, workspaceId)).map((m) => m.workspaceId);
    const rows = await this.db
      .select(accountColumns)
      .from(accounts)
      .where(inArray(accounts.workspaceId, ids))
      .orderBy(accounts.createdAt, accounts.id);
    return rows.map(toView);
  }

  createAccount(actorId: string, input: CreateAccount): Promise<AccountView> {
    return this.write(async (tx) => {
      await this.policy.requireMember(actorId, input.workspaceId, tx);
      const [row] = await tx.insert(accounts).values(input).returning(accountColumns);
      return toView(row!);
    });
  }

  updateAccount(actorId: string, id: string, patch: UpdateAccount): Promise<AccountView> {
    return this.write(async (tx) => {
      const [current] = await tx.select(accountColumns).from(accounts).where(eq(accounts.id, id));
      if (!current) throw new ApiError('NOT_FOUND');
      await this.policy.requireMember(actorId, current.workspaceId, tx);
      const { archived, ...fields } = changes(current, patch);
      if (Object.keys(fields).length === 0 && archived === undefined) return toView(current);
      const [row] = await tx
        .update(accounts)
        .set({ ...fields, ...archivedPatch(archived) })
        .where(eq(accounts.id, id))
        .returning(accountColumns);
      return toView(row!);
    });
  }

  async listCategories(actorId: string, workspaceId?: string): Promise<CategoryView[]> {
    const ids = (await this.policy.scope(actorId, workspaceId)).map((m) => m.workspaceId);
    const rows = await this.db
      .select(categoryColumns)
      .from(categories)
      .where(inArray(categories.workspaceId, ids))
      .orderBy(categories.kind, categories.name, categories.id);
    return rows.map(toView);
  }

  createCategory(actorId: string, input: CreateCategory): Promise<CategoryView> {
    return this.write(async (tx) => {
      await this.policy.requireMember(actorId, input.workspaceId, tx);
      const [row] = await tx.insert(categories).values(input).returning(categoryColumns);
      return toView(row!);
    });
  }

  updateCategory(actorId: string, id: string, patch: UpdateCategory): Promise<CategoryView> {
    return this.write(async (tx) => {
      const [current] = await tx
        .select(categoryColumns)
        .from(categories)
        .where(eq(categories.id, id));
      if (!current) throw new ApiError('NOT_FOUND');
      await this.policy.requireMember(actorId, current.workspaceId, tx);
      if (patch.name === null && current.systemKey === null) {
        throw new ApiError('VALIDATION_FAILED', 'only a default category can drop its name');
      }
      const { archived, ...fields } = changes(current, patch);
      if (Object.keys(fields).length === 0 && archived === undefined) {
        return toView(current);
      }
      const [row] = await tx
        .update(categories)
        .set({ ...fields, ...archivedPatch(archived) })
        .where(eq(categories.id, id))
        .returning(categoryColumns);
      return toView(row!);
    });
  }

  /** Views of the given rows as `actorId` sees them, keyed by id; invisible rows are absent. */
  async ledgerRows(
    tx: Tx,
    actorId: string,
    ids: readonly string[],
  ): Promise<Map<string, LedgerRow>> {
    if (ids.length === 0) return new Map();
    const visible = new Set((await this.policy.memberships(actorId, tx)).map((m) => m.workspaceId));
    const rows = await selectViewRows(tx).where(
      and(inArray(transactions.id, [...ids]), inArray(transactions.workspaceId, [...visible])),
    );
    return new Map(rows.map((row) => [row.id, toLedgerRow(row, visible)]));
  }

  private async write<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await ledgerTransaction(this.db, work);
    } catch (error) {
      if (
        isUniqueViolation(error, 'accounts_name_uq') ||
        isUniqueViolation(error, 'categories_name_uq')
      ) {
        throw new ApiError('NAME_TAKEN');
      }
      throw error;
    }
  }
}
