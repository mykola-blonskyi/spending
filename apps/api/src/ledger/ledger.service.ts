import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
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
import { decodeCursor, encodeCursor, escapeLike, type TransactionQuery } from './history';
import {
  type AccountView,
  type CategoryView,
  createAccountSchema,
  createCategorySchema,
  type LedgerRow,
  toAccountView,
  toCategoryView,
  toLedgerRow,
  type TransactionView,
  updateAccountSchema,
  updateCategorySchema,
} from './views';

type CreateAccount = z.infer<typeof createAccountSchema>;
type UpdateAccount = z.infer<typeof updateAccountSchema>;
type CreateCategory = z.infer<typeof createCategorySchema>;
type UpdateCategory = z.infer<typeof updateCategorySchema>;

const accountColumns = {
  id: accounts.id,
  workspaceId: accounts.workspaceId,
  name: accounts.name,
  kind: accounts.kind,
  currency: accounts.currency,
  archivedAt: accounts.archivedAt,
  revision: accounts.revision,
  createdAt: accounts.createdAt,
  updatedAt: accounts.updatedAt,
};

const categoryColumns = {
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
  previousWorkspaceId: transactions.previousWorkspaceId,
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
  createdBy: transactions.createdBy,
  authorName: users.displayName,
  version: transactions.version,
  revision: transactions.revision,
  deletedAt: transactions.deletedAt,
  createdAt: transactions.createdAt,
  updatedAt: transactions.updatedAt,
};

const historyKey = sql<string>`to_char(${transactions.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

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
  archived === undefined ? {} : { archivedAt: archived ? sql`coalesce(archived_at, now())` : null };

@Injectable()
export class LedgerService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AccessPolicy) private readonly policy: AccessPolicy,
  ) {}

  async listAccounts(actorId: string, workspaceId?: string): Promise<AccountView[]> {
    const ids = await this.scope(actorId, workspaceId);
    const rows = await this.db
      .select(accountColumns)
      .from(accounts)
      .where(inArray(accounts.workspaceId, ids))
      .orderBy(accounts.createdAt, accounts.id);
    return rows.map(toAccountView);
  }

  createAccount(actorId: string, input: CreateAccount): Promise<AccountView> {
    return this.write(async (tx) => {
      await this.policy.requireMember(actorId, input.workspaceId, tx);
      const [row] = await tx.insert(accounts).values(input).returning(accountColumns);
      return toAccountView(row!);
    });
  }

  updateAccount(actorId: string, id: string, patch: UpdateAccount): Promise<AccountView> {
    return this.write(async (tx) => {
      const [current] = await tx.select(accountColumns).from(accounts).where(eq(accounts.id, id));
      if (!current) throw new ApiError('NOT_FOUND');
      await this.policy.requireMember(actorId, current.workspaceId, tx);
      const { archived, ...fields } = patch;
      if (Object.keys(fields).length === 0 && archived === undefined) return toAccountView(current);
      const [row] = await tx
        .update(accounts)
        .set({ ...fields, ...archivedPatch(archived) })
        .where(eq(accounts.id, id))
        .returning(accountColumns);
      return toAccountView(row!);
    });
  }

  async listCategories(actorId: string, workspaceId?: string): Promise<CategoryView[]> {
    const ids = await this.scope(actorId, workspaceId);
    const rows = await this.db
      .select(categoryColumns)
      .from(categories)
      .where(inArray(categories.workspaceId, ids))
      .orderBy(categories.kind, categories.name, categories.id);
    return rows.map(toCategoryView);
  }

  createCategory(actorId: string, input: CreateCategory): Promise<CategoryView> {
    return this.write(async (tx) => {
      await this.policy.requireMember(actorId, input.workspaceId, tx);
      const [row] = await tx.insert(categories).values(input).returning(categoryColumns);
      return toCategoryView(row!);
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
      const { archived, ...fields } = patch;
      if (Object.keys(fields).length === 0 && archived === undefined) {
        return toCategoryView(current);
      }
      const [row] = await tx
        .update(categories)
        .set({ ...fields, ...archivedPatch(archived) })
        .where(eq(categories.id, id))
        .returning(categoryColumns);
      return toCategoryView(row!);
    });
  }

  /**
   * Server-side history (ADR-006) for export and API clients. Tombstones never appear (BR-16);
   * pending-review rows only on request, and only from the actor's personal workspace (BR-21).
   */
  async listTransactions(
    actorId: string,
    query: TransactionQuery,
  ): Promise<{ transactions: TransactionView[]; nextCursor: string | null }> {
    const memberships = await this.policy.memberships(actorId);
    const visible = new Set(memberships.map((m) => m.workspaceId));
    if (query.workspaceId) await this.policy.requireMember(actorId, query.workspaceId);
    const pending = query.reviewStatus === 'pending_review';
    const searched = memberships
      .filter((m) => !query.workspaceId || m.workspaceId === query.workspaceId)
      .filter((m) => !query.scope || m.kind === query.scope)
      .filter((m) => !pending || m.kind === 'personal')
      .map((m) => m.workspaceId);
    if (searched.length === 0) return { transactions: [], nextCursor: null };

    const conditions: (SQL | undefined)[] = [
      inArray(transactions.workspaceId, searched),
      isNull(transactions.deletedAt),
      eq(transactions.reviewStatus, query.reviewStatus ?? 'confirmed'),
      query.from ? sql`${transactions.occurredOn} >= ${query.from}` : undefined,
      query.to ? sql`${transactions.occurredOn} <= ${query.to}` : undefined,
      query.kind ? eq(transactions.kind, query.kind) : undefined,
      query.currency ? eq(transactions.currency, query.currency) : undefined,
      query.categoryId ? eq(transactions.categoryId, query.categoryId) : undefined,
      // BR-3: an account the actor cannot see must not be usable as a filter either.
      query.accountId
        ? and(
            eq(transactions.accountId, query.accountId),
            inArray(accounts.workspaceId, [...visible]),
          )
        : undefined,
    ];
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`;
      conditions.push(
        sql`(${transactions.description} ilike ${pattern} or ${transactions.note} ilike ${pattern})`,
      );
    }
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      if (!cursor) throw new ApiError('VALIDATION_FAILED', 'Invalid cursor');
      conditions.push(
        sql`(${transactions.occurredOn}, ${transactions.createdAt}, ${transactions.id})
            < (${cursor.occurredOn}::date, ${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
      );
    }
    const rows = await this.db
      .select({ ...viewColumns, historyKey })
      .from(transactions)
      .innerJoin(workspaces, eq(workspaces.id, transactions.workspaceId))
      .leftJoin(users, eq(users.id, transactions.createdBy))
      .leftJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(and(...conditions))
      .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt), desc(transactions.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? encodeCursor({ occurredOn: last.occurredOn, createdAt: last.historyKey, id: last.id })
        : null;
    return {
      transactions: page.map((row) => toLedgerRow(row, visible) as TransactionView),
      nextCursor,
    };
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

  private async scope(actorId: string, workspaceId: string | undefined): Promise<string[]> {
    if (workspaceId) return [(await this.policy.requireMember(actorId, workspaceId)).workspaceId];
    return (await this.policy.memberships(actorId)).map((m) => m.workspaceId);
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
