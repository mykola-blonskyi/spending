import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { and, between, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { addDays } from '../common/dates';
import { ApiError } from '../common/errors';
import { type CurrencyCode } from '../common/money';
import { DB, type Db, ledgerTransaction, type Tx } from '../database/database.module';
import { accounts, categories, importBatches, transactions, users } from '../database/schema';
import { convert, type RateQuote } from '../ledger/fx/conversion';
import { FxService } from '../ledger/fx/fx.service';
import { LedgerService, releaseLoneSides, selectViewRows } from '../ledger/ledger.service';
import { loadReferenceFacts, referenceError, transferError } from '../ledger/rules';
import { type EntryKind, toLedgerRow, type TransactionView } from '../ledger/views';
import { AccessPolicy } from '../workspaces/access-policy';
import { categorize } from './categorize';
import { learnCategoryRules, loadCatalog } from './category-rules';
import { importHashes } from './dedupe';
import { validateRows } from './rows';
import { type MatchRow, suggestTransfers, TRANSFER_WINDOW_DAYS } from './transfer-match';
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

type LinkSide = Readonly<{ id: string; kind: EntryKind; accountId: string | null }>;
type Counterpart = LinkSide &
  Readonly<{
    workspaceId: string;
    transferId: string | null;
    reviewStatus: 'confirmed' | 'pending_review';
  }>;

/**
 * BR-37, BR-38: the transfer id each row confirmed as a transfer takes, and the confirmed
 * counterparts with it. A counterpart is a live non-transfer entry of the personal workspace on
 * another account, of the opposite kind, used once: confirmed already, or awaiting review in
 * this request and pointing back.
 */
function transferLinks(
  items: readonly ConfirmItem[],
  pending: ReadonlyMap<string, LinkSide>,
  counterparts: ReadonlyMap<string, Counterpart>,
  personalId: string,
): Map<string, string> {
  const pointsTo = new Map(items.map((i) => [i.transactionId, i.transfer?.counterpartId]));
  const links = new Map<string, string>();
  for (const item of items) {
    if (!item.transfer || links.has(item.transactionId)) continue;
    const row = pending.get(item.transactionId)!;
    const transferId = crypto.randomUUID();
    links.set(row.id, transferId);
    const { counterpartId } = item.transfer;
    if (counterpartId === null) continue;
    const other = counterparts.get(counterpartId);
    const fits =
      other !== undefined &&
      other.transferId === null &&
      other.accountId !== row.accountId &&
      !links.has(other.id) &&
      (other.reviewStatus === 'confirmed' || pointsTo.get(other.id) === row.id) &&
      transferError(
        {
          workspaceId: personalId,
          kind: row.kind,
          categoryId: null,
          transferId,
          transferOutside: false,
        },
        [{ workspaceId: other.workspaceId, kind: other.kind, transferOutside: false }],
      ) === null;
    if (!fits) throw new ApiError('INVALID_TRANSFER');
    links.set(other.id, transferId);
  }
  return links;
}

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
      const insertedIds = new Set(transactionIds);
      // BR-38: a row waiting for review cannot be marked yet (REVIEW_REQUIRED), so only confirmed ones.
      const transferSuggestions =
        reviewStatus === 'confirmed'
          ? await this.transferSuggestions(
              tx,
              actorId,
              workspaceId,
              account.id,
              values.filter((value) => insertedIds.has(value.id)),
              quotes,
            )
          : [];
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
          transferSuggestions,
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
        await releaseLoneSides(
          tx,
          undone.flatMap((row) => (row.transferId ? [row.transferId] : [])),
        );
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

  /**
   * BR-30. Removes undone batches of the actor from the history, one by `id` or all. Entries stay;
   * their link to the batch is nulled by the foreign key, and their dedupe keys are untouched.
   */
  async remove(actorId: string, id?: string) {
    const removed = await this.db
      .delete(importBatches)
      .where(
        and(
          eq(importBatches.userId, actorId),
          isNotNull(importBatches.undoneAt),
          id ? eq(importBatches.id, id) : undefined,
        ),
      )
      .returning({ id: importBatches.id });
    if (id && removed.length === 0) {
      const [batch] = await this.db
        .select({ id: importBatches.id })
        .from(importBatches)
        .where(and(eq(importBatches.id, id), eq(importBatches.userId, actorId)));
      throw new ApiError(batch ? 'CONFLICT' : 'NOT_FOUND');
    }
    return { removed: removed.length };
  }

  /**
   * BR-28. The actor's rows awaiting review, with what the family workspace would suggest and,
   * BR-38, a transfer counterpart among the confirmed entries and the other rows awaiting review.
   */
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
      const suggestions = await this.transferSuggestions(
        tx,
        actorId,
        personalId,
        null,
        rows.map((row) => ({ ...row, currency: row.currency as CurrencyCode })),
        new Map(),
      );
      const suggestionOf = new Map(suggestions.map((s) => [s.transactionId, s]));
      const visible = new Set([personalId, ...(family ? [family.workspaceId] : [])]);
      return rows.map((row) => {
        const suggestion = suggestionOf.get(row.id);
        return {
          transaction: toLedgerRow(row, visible) as TransactionView,
          familyCategoryId: familyCatalog
            ? categorize(row.description, row.kind, familyCatalog)
            : null,
          ...(suggestion && {
            transferSuggestion: {
              counterpartId: suggestion.counterpartId,
              reason: suggestion.reason,
            },
          }),
        };
      });
    });
  }

  /**
   * BR-28. Publishes reviewed rows in one transaction: each takes its category (of the target
   * workspace and the row's kind, BR-4) and moves to the family when asked. The account stays,
   * which BR-3 allows for the author's personal account. Each chosen category is learned (BR-29).
   * A row confirmed as a transfer stays personal without a category and is linked here (BR-38).
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
          currency: transactions.currency,
          accountId: transactions.accountId,
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
      const references = await loadReferenceFacts(
        tx,
        [],
        items.map((i) => i.categoryId),
      );
      const confirmed = items.map((item) => {
        const row = rows.get(item.transactionId);
        const target = item.scope === 'family' ? familyId : personalId;
        if (!row || !target) throw new ApiError('NOT_FOUND');
        const error = referenceError({
          workspaceId: target,
          kind: row.kind,
          currency: row.currency,
          accountId: null,
          categoryId: item.categoryId,
          current: { accountId: null, categoryId: row.categoryId },
          isAuthor: true,
          authorPersonalWorkspaceId: personalId,
          account: null,
          category: references.categories.get(item.categoryId ?? '') ?? null,
        });
        if (error) throw new ApiError(error);
        return {
          id: row.id,
          description: row.description,
          workspaceId: target,
          categoryId: item.categoryId,
          bankCategory: item.bankCategory,
        };
      });
      const counterpartIds = items.flatMap((i) =>
        i.transfer?.counterpartId ? [i.transfer.counterpartId] : [],
      );
      const counterparts =
        counterpartIds.length === 0
          ? []
          : await tx
              .select({
                id: transactions.id,
                kind: transactions.kind,
                accountId: transactions.accountId,
                workspaceId: transactions.workspaceId,
                transferId: transactions.transferId,
                reviewStatus: transactions.reviewStatus,
              })
              .from(transactions)
              .where(and(inArray(transactions.id, counterpartIds), isNull(transactions.deletedAt)));
      const links = transferLinks(
        items,
        rows,
        new Map(counterparts.map((c) => [c.id, c])),
        personalId,
      );
      const outside = new Set(
        items.flatMap((i) => (i.transfer?.counterpartId === null ? [i.transactionId] : [])),
      );
      const linkedConfirmed = counterparts.filter(
        (c) => c.reviewStatus === 'confirmed' && links.has(c.id),
      );
      const values = sql.join(
        [...confirmed, ...linkedConfirmed.map((c) => ({ ...c, categoryId: null }))].map(
          (c) =>
            sql`(${c.id}::uuid, ${c.workspaceId}::uuid, ${c.categoryId}::uuid, ${links.get(c.id) ?? null}::uuid, ${outside.has(c.id)}::boolean)`,
        ),
        sql`, `,
      );
      await tx.execute(sql`
        update transactions t
        set workspace_id = v.workspace_id, category_id = v.category_id, review_status = 'confirmed',
          transfer_id = v.transfer_id, transfer_outside = v.transfer_outside
        from (values ${values}) as v(id, workspace_id, category_id, transfer_id, transfer_outside)
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

  /**
   * BR-38. Candidates are the live, confirmed, non-transfer entries of the workspace (on its other
   * accounts than the import's, when given) around the imported dates, read with one query, and
   * the imported rows themselves; rates come per currency of both, as for the import itself.
   */
  private async transferSuggestions(
    tx: Tx,
    actorId: string,
    workspaceId: string,
    accountId: string | null,
    imported: readonly MatchRow[],
    quotes: Map<CurrencyCode, Map<string, RateQuote | null>>,
  ) {
    if (imported.length === 0) return [];
    const dates = imported.map((row) => row.occurredOn).sort();
    const candidates = await tx
      .select({
        id: transactions.id,
        kind: transactions.kind,
        amountMinor: transactions.amountMinor,
        currency: transactions.currency,
        occurredOn: transactions.occurredOn,
        accountId: transactions.accountId,
        description: transactions.description,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          accountId === null ? undefined : ne(transactions.accountId, accountId),
          isNull(transactions.deletedAt),
          isNull(transactions.transferId),
          eq(transactions.reviewStatus, 'confirmed'),
          between(
            transactions.occurredOn,
            addDays(dates[0]!, -TRANSFER_WINDOW_DAYS),
            addDays(dates.at(-1)!, TRANSFER_WINDOW_DAYS),
          ),
        ),
      )
      .orderBy(transactions.occurredOn, transactions.id);
    const currencies = [
      ...candidates.map((row) => row.currency as CurrencyCode),
      ...imported.map((row) => row.currency),
    ];
    for (const currency of new Set(currencies)) {
      if (!quotes.has(currency)) quotes.set(currency, await this.fx.quotes(tx, currency, dates));
    }
    const [user] = await tx
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, actorId));
    return suggestTransfers(
      imported,
      [
        ...candidates.map((row) => ({ ...row, currency: row.currency as CurrencyCode })),
        ...imported,
      ],
      user?.displayName ?? '',
      (currency, date) => quotes.get(currency)?.get(date) ?? null,
    );
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
