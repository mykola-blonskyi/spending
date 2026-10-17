import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../common/errors';
import { type CurrencyCode } from '../common/money';
import { DB, type Db, ledgerTransaction, type Tx } from '../database/database.module';
import { accounts, categories, importBatches, transactions } from '../database/schema';
import { convert, type RateQuote } from '../ledger/fx/conversion';
import { FxService } from '../ledger/fx/fx.service';
import { LedgerService, selectViewRows } from '../ledger/ledger.service';
import { toLedgerRow, type TransactionView } from '../ledger/views';
import { AccessPolicy } from '../workspaces/access-policy';
import { categorize } from './categorize';
import { learnCategoryRules, loadCatalog } from './category-rules';
import { importHashes } from './dedupe';
import { validateRows } from './rows';
import {
  batchColumns,
  type ConfirmItem,
  type LearnItem,
  type ImportBatchView,
  type ImportBody,
  type importResultSchema,
  toBatchView,
} from './schemas';

/** Keeps one multi-row insert well under PostgreSQL's 65535 bind parameters. */
const INSERT_CHUNK = 500;

@Injectable()
export class ImportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AccessPolicy) private readonly policy: AccessPolicy,
    @Inject(FxService) private readonly fx: FxService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  /**
   * BR-26. Imports land in the actor's personal workspace; one transaction holds the batch. A
   * family member's rows wait for review (BR-28) with the personal category suggestion.
   */
  create(actorId: string, body: ImportBody): Promise<z.infer<typeof importResultSchema>> {
    return ledgerTransaction(this.db, async (tx) => {
      const workspaceId = await this.policy.personalWorkspaceId(actorId, tx);
      const account = await this.importAccount(tx, actorId, workspaceId, body.accountId);
      const { valid, rejected } = validateRows(body.rows, account.currency);
      const [batch] = await tx
        .insert(importBatches)
        .values({
          workspaceId,
          userId: actorId,
          accountId: account.id,
          fileName: body.fileName,
          mapping: body.mapping,
          rowCount: body.rows.length,
          importedCount: 0,
          duplicateCount: 0,
          rejectedCount: rejected.length,
          rejected,
        })
        .returning({ id: importBatches.id });
      const hashes = importHashes(account.id, valid);
      const catalog = await loadCatalog(tx, workspaceId);
      const reviewStatus = (await this.policy.familyMembership(actorId, tx))
        ? ('pending_review' as const)
        : ('confirmed' as const);
      // One rate query per currency, not per row: the ledger lock is held.
      const quotes = new Map<CurrencyCode, Map<string, RateQuote | null>>();
      for (const currency of new Set(valid.map((row) => row.currency))) {
        const dates = valid.filter((row) => row.currency === currency).map((row) => row.occurredOn);
        quotes.set(currency, await this.fx.quotes(tx, currency, dates));
      }
      const values = [];
      const bankCategories = new Map<string, string>();
      for (const [index, row] of valid.entries()) {
        const id = crypto.randomUUID();
        if (row.bankCategory) bankCategories.set(id, row.bankCategory);
        values.push({
          id,
          workspaceId,
          createdBy: actorId,
          kind: row.kind,
          amountMinor: row.amountMinor,
          currency: row.currency,
          occurredOn: row.occurredOn,
          accountId: account.id,
          categoryId: categorize(row.description, row.kind, catalog, row),
          description: row.description,
          externalId: row.externalId,
          importHash: hashes[index]!,
          source: 'import' as const,
          reviewStatus,
          importBatchId: batch!.id,
          ...convert(
            row.amountMinor,
            row.currency,
            quotes.get(row.currency)?.get(row.occurredOn) ?? null,
          ),
        });
      }
      const transactionIds: string[] = [];
      for (let i = 0; i < values.length; i += INSERT_CHUNK) {
        const inserted = await tx
          .insert(transactions)
          .values(values.slice(i, i + INSERT_CHUNK))
          // BR-27: a row whose key exists (imported before, or deleted since) is a duplicate.
          .onConflictDoNothing({
            target: transactions.importHash,
            where: sql`${transactions.importHash} is not null`,
          })
          .returning({ id: transactions.id });
        transactionIds.push(...inserted.map((r) => r.id));
      }
      const duplicates = valid.length - transactionIds.length;
      const [stored] = await tx
        .update(importBatches)
        .set({ importedCount: transactionIds.length, duplicateCount: duplicates })
        .where(eq(importBatches.id, batch!.id))
        .returning(batchColumns);
      return {
        batch: toBatchView(stored!),
        imported: {
          count: transactionIds.length,
          transactionIds,
          bankCategories: Object.fromEntries(
            transactionIds.flatMap((id) => {
              const bankCategory = bankCategories.get(id);
              return bankCategory ? [[id, bankCategory]] : [];
            }),
          ),
        },
        duplicates,
        rejected,
      };
    });
  }

  async list(actorId: string): Promise<ImportBatchView[]> {
    const rows = await this.db
      .select(batchColumns)
      .from(importBatches)
      .where(eq(importBatches.userId, actorId))
      .orderBy(desc(importBatches.createdAt), desc(importBatches.id));
    return rows.map(toBatchView);
  }

  /**
   * BR-30. Tombstones the batch's rows nobody edited (still version 1 in the personal workspace)
   * and clears their keys so the statement can be imported again. A transfer side left without its
   * partner becomes a one-sided transfer. Repeating it changes nothing.
   * The counts are read back from the rows at the time it runs, so a manual delete in between
   * changes what a repeat reports.
   */
  undo(actorId: string, id: string) {
    return ledgerTransaction(this.db, async (tx) => {
      const [batch] = await tx
        .select({ ...batchColumns, workspaceId: importBatches.workspaceId })
        .from(importBatches)
        .where(and(eq(importBatches.id, id), eq(importBatches.userId, actorId)));
      if (!batch) throw new ApiError('NOT_FOUND');
      let stored = batch;
      if (!batch.undoneAt) {
        const undone = await tx
          .update(transactions)
          .set({ deletedAt: sql`now()`, importHash: null })
          .where(
            and(
              eq(transactions.importBatchId, id),
              eq(transactions.workspaceId, batch.workspaceId),
              eq(transactions.version, 1),
              isNull(transactions.deletedAt),
            ),
          )
          .returning({ transferId: transactions.transferId });
        const transferIds = undone.flatMap((row) => (row.transferId ? [row.transferId] : []));
        // A transfer has at most two sides, so a side still live here has lost its partner (BR-37).
        if (transferIds.length > 0) {
          await tx
            .update(transactions)
            .set({ transferOutside: true })
            .where(
              and(
                inArray(transactions.transferId, transferIds),
                isNull(transactions.deletedAt),
                eq(transactions.transferOutside, false),
              ),
            );
        }
        const [updated] = await tx
          .update(importBatches)
          .set({ undoneAt: sql`now()` })
          .where(eq(importBatches.id, id))
          .returning({ ...batchColumns, workspaceId: importBatches.workspaceId });
        stored = updated!;
      }
      const [counts] = await tx
        .select({
          deleted: sql<number>`count(*) filter (where ${transactions.deletedAt} is not null and ${transactions.importHash} is null)::int`,
          kept: sql<number>`count(*) filter (where ${transactions.deletedAt} is null)::int`,
        })
        .from(transactions)
        .where(eq(transactions.importBatchId, id));
      return { batch: toBatchView(stored), deleted: counts!.deleted, kept: counts!.kept };
    });
  }

  /** BR-28. The actor's rows awaiting review, with what the family workspace would suggest. */
  async review(actorId: string) {
    return this.db.transaction(async (tx) => {
      const personalId = await this.policy.personalWorkspaceId(actorId, tx);
      const family = await this.policy.familyMembership(actorId, tx);
      const familyCatalog = family ? await loadCatalog(tx, family.workspaceId) : null;
      const rows = await selectViewRows(tx)
        .where(
          and(
            eq(transactions.workspaceId, personalId),
            eq(transactions.createdBy, actorId),
            eq(transactions.reviewStatus, 'pending_review'),
            isNull(transactions.deletedAt),
          ),
        )
        .orderBy(
          desc(transactions.occurredOn),
          desc(transactions.createdAt),
          desc(transactions.id),
        );
      const visible = new Set([personalId, ...(family ? [family.workspaceId] : [])]);
      return rows.map((row) => ({
        transaction: toLedgerRow(row, visible) as TransactionView,
        familyCategoryId: familyCatalog
          ? categorize(row.description, row.kind, familyCatalog)
          : null,
      }));
    });
  }

  /**
   * BR-28. Publishes reviewed rows in one transaction: each takes its category (of the target
   * workspace and the row's kind, BR-4) and moves to the family when asked. The account stays,
   * which BR-3 allows for the author's personal account. Each chosen category is learned (BR-29).
   */
  confirm(actorId: string, items: readonly ConfirmItem[]): Promise<TransactionView[]> {
    return ledgerTransaction(this.db, async (tx) => {
      const personalId = await this.policy.personalWorkspaceId(actorId, tx);
      const familyId = (await this.policy.familyMembership(actorId, tx))?.workspaceId;
      const ids = items.map((i) => i.transactionId);
      const pending = await tx
        .select({
          id: transactions.id,
          kind: transactions.kind,
          description: transactions.description,
          categoryId: transactions.categoryId,
        })
        .from(transactions)
        .where(
          and(
            inArray(transactions.id, ids),
            eq(transactions.workspaceId, personalId),
            eq(transactions.createdBy, actorId),
            eq(transactions.reviewStatus, 'pending_review'),
            isNull(transactions.deletedAt),
          ),
        );
      const rows = new Map(pending.map((r) => [r.id, r]));
      const categoryIds = items.flatMap((i) => (i.categoryId ? [i.categoryId] : []));
      const found =
        categoryIds.length === 0
          ? []
          : await tx
              .select({
                id: categories.id,
                workspaceId: categories.workspaceId,
                kind: categories.kind,
                archivedAt: categories.archivedAt,
              })
              .from(categories)
              .where(inArray(categories.id, categoryIds));
      const categoryById = new Map(found.map((c) => [c.id, c]));
      const confirmed = items.map((item) => {
        const row = rows.get(item.transactionId);
        const target = item.scope === 'family' ? familyId : personalId;
        if (!row || !target) throw new ApiError('NOT_FOUND');
        if (item.categoryId) {
          const category = categoryById.get(item.categoryId);
          if (
            !category ||
            category.workspaceId !== target ||
            category.kind !== row.kind ||
            (category.archivedAt && category.id !== row.categoryId)
          ) {
            throw new ApiError('INVALID_CATEGORY');
          }
        }
        return {
          id: row.id,
          description: row.description,
          workspaceId: target,
          categoryId: item.categoryId,
          bankCategory: item.bankCategory,
        };
      });
      const values = sql.join(
        confirmed.map((c) => sql`(${c.id}::uuid, ${c.workspaceId}::uuid, ${c.categoryId}::uuid)`),
        sql`, `,
      );
      await tx.execute(sql`
        update transactions t
        set workspace_id = v.workspace_id, category_id = v.category_id, review_status = 'confirmed'
        from (values ${values}) as v(id, workspace_id, category_id)
        where t.id = v.id`);
      await learnCategoryRules(
        tx,
        confirmed.flatMap(({ categoryId, ...rule }) =>
          categoryId ? [{ ...rule, categoryId }] : [],
        ),
      );
      const views = await this.ledger.ledgerRows(tx, actorId, ids);
      return ids.map((id) => views.get(id) as TransactionView);
    });
  }

  /**
   * BR-29. Categories chosen on the import summary, with the bank category only the browser
   * still holds: each becomes a bank-category rule. The description rule comes with the sync push.
   */
  learn(actorId: string, items: readonly LearnItem[]): Promise<void> {
    return this.db.transaction(async (tx) => {
      const personalId = await this.policy.personalWorkspaceId(actorId, tx);
      const rows = await tx
        .select({ id: transactions.id, kind: transactions.kind })
        .from(transactions)
        .where(
          and(
            inArray(
              transactions.id,
              items.map((i) => i.transactionId),
            ),
            eq(transactions.workspaceId, personalId),
            eq(transactions.createdBy, actorId),
            eq(transactions.source, 'import'),
            isNull(transactions.deletedAt),
          ),
        );
      const found = await tx
        .select({ id: categories.id, kind: categories.kind })
        .from(categories)
        .where(
          and(
            inArray(
              categories.id,
              items.map((i) => i.categoryId),
            ),
            eq(categories.workspaceId, personalId),
            isNull(categories.archivedAt),
          ),
        );
      const kindOf = new Map(rows.map((r) => [r.id, r.kind]));
      const categoryKind = new Map(found.map((c) => [c.id, c.kind]));
      for (const item of items) {
        const kind = kindOf.get(item.transactionId);
        if (!kind) throw new ApiError('NOT_FOUND');
        if (categoryKind.get(item.categoryId) !== kind) throw new ApiError('INVALID_CATEGORY');
      }
      await learnCategoryRules(
        tx,
        items.map(({ categoryId, bankCategory }) => ({
          workspaceId: personalId,
          categoryId,
          bankCategory,
        })),
      );
    });
  }

  /** The target must be a live account of the actor's personal workspace. */
  private async importAccount(tx: Tx, actorId: string, personalId: string, accountId: string) {
    const visible = (await this.policy.memberships(actorId, tx)).map((m) => m.workspaceId);
    const [account] = await tx
      .select({
        id: accounts.id,
        workspaceId: accounts.workspaceId,
        currency: accounts.currency,
        archivedAt: accounts.archivedAt,
      })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), inArray(accounts.workspaceId, visible)));
    if (!account) throw new ApiError('NOT_FOUND');
    if (account.workspaceId !== personalId || account.archivedAt) {
      throw new ApiError('INVALID_ACCOUNT');
    }
    return { id: account.id, currency: account.currency as CurrencyCode };
  }
}
