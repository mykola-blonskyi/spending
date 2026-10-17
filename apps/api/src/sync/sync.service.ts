import { z } from 'zod';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, desc, eq, exists, gt, inArray, isNull, lt, ne, not, sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../common/config';
import { ApiError } from '../common/errors';
import type { CurrencyCode } from '../common/money';
import { DB, type Db, ledgerTransaction, type Tx } from '../database/database.module';
import {
  accounts,
  categories,
  syncConflicts,
  syncEpoch,
  syncMutations,
  syncTombstones,
  transactions,
} from '../database/schema';
import { FxService } from '../ledger/fx/fx.service';
import { LedgerService, selectViewRows } from '../ledger/ledger.service';
import {
  type AccountView,
  type CategoryView,
  type Tombstone,
  toView,
  toLedgerRow,
} from '../ledger/views';
import { learnCategoryRules } from '../imports/category-rules';
import { AccessPolicy } from '../workspaces/access-policy';
import {
  type ConflictLocal,
  conflictViewSchema,
  decideDelete,
  decideUpsert,
  DELETED,
  effectiveAccountId,
  type ExistingRow,
  type IntendedFields,
  type Mutation,
  pullWindow,
  pushResultSchema,
  type RejectCode,
  type TransactionInput,
} from './mutations';

const MUTATION_RETENTION_DAYS = 180;

/** A third of the web client's 30 s push timeout. */
const PUSH_BUDGET_MS = 10_000;

/** What `sync_mutations.result` keeps; replays rebuild the row view fresh (BR-18). */
type Outcome =
  | { status: 'applied'; transactionId: string }
  | { status: 'conflict'; conflictId: string; transactionId: string }
  | { status: 'rejected'; code: string; message: string };

export type PushResult = z.infer<typeof pushResultSchema>;
export type ConflictView = z.infer<typeof conflictViewSchema>;

const rejected = (code: RejectCode | 'MUTATION_ID_REUSED'): Outcome => ({
  status: 'rejected',
  code,
  message: code,
});

/** `current` writes against whatever version the server holds now; it exists only for conflict resolution, so `conflict()` never runs for it. */
type Base = number | null | 'current';
type DeleteBase = number | 'current';

const existingColumns = {
  workspaceId: transactions.workspaceId,
  kind: transactions.kind,
  amountMinor: transactions.amountMinor,
  currency: transactions.currency,
  occurredOn: transactions.occurredOn,
  accountId: transactions.accountId,
  categoryId: transactions.categoryId,
  description: transactions.description,
  note: transactions.note,
  transferId: transactions.transferId,
  transferOutside: transactions.transferOutside,
  createdBy: transactions.createdBy,
  version: transactions.version,
  reviewStatus: transactions.reviewStatus,
  deletedAt: transactions.deletedAt,
};

@Injectable()
export class SyncService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AccessPolicy) private readonly policy: AccessPolicy,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(FxService) private readonly fx: FxService,
  ) {}

  /**
   * Each mutation commits on its own, so one rejection never blocks the rest (ADR-006). A push
   * answers only the mutations it reached once the client has gone (`gone`) or `budgetMs` has
   * passed; the client sends the rest again at once. Finishing a batch nobody waits for, or one
   * that outlasts the client's timeout, only queues more work behind the ledger lock.
   */
  async push(
    actorId: string,
    mutations: readonly Mutation[],
    gone?: AbortSignal,
    budgetMs = PUSH_BUDGET_MS,
  ): Promise<PushResult[]> {
    const started = Date.now();
    const results: PushResult[] = [];
    for (const mutation of mutations) {
      if (gone?.aborted || (results.length > 0 && Date.now() - started > budgetMs)) break;
      results.push(
        await ledgerTransaction(this.db, async (tx) => {
          const [stored] = await tx
            .select()
            .from(syncMutations)
            .where(eq(syncMutations.id, mutation.mutationId));
          let outcome: Outcome;
          if (stored) {
            outcome =
              stored.userId === actorId
                ? (stored.result as Outcome)
                : rejected('MUTATION_ID_REUSED');
          } else {
            outcome = await this.apply(tx, actorId, mutation);
            await tx
              .insert(syncMutations)
              .values({ id: mutation.mutationId, userId: actorId, result: outcome });
          }
          return this.present(tx, actorId, mutation.mutationId, outcome);
        }),
      );
    }
    return results;
  }

  /**
   * BR-18. A replay of a pruned mutation is decided again on the row, which never duplicates it
   * or overwrites a newer change (BR-19), so old outcomes need not be kept.
   */
  async pruneMutations(): Promise<number> {
    const pruned = await this.db
      .delete(syncMutations)
      .where(
        lt(syncMutations.createdAt, sql`now() - make_interval(days => ${MUTATION_RETENTION_DAYS})`),
      )
      .returning({ id: syncMutations.id });
    return pruned.length;
  }

  /**
   * One repeatable-read snapshot covers all four sources. Separate snapshots could see a late row
   * in one source but miss an earlier-revision row in another, and the cursor would skip it.
   */
  pull(actorId: string, cursor: number, limit: number) {
    return this.db.transaction((tx) => this.pullIn(tx, actorId, cursor, limit), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
  }

  private async pullIn(tx: Tx, actorId: string, cursor: number, limit: number) {
    const list = await this.policy.memberships(actorId, tx);
    const ids = list.map((m) => m.workspaceId);
    const visible = new Set(ids);
    const accountRows = await tx
      .select()
      .from(accounts)
      .where(and(inArray(accounts.workspaceId, ids), gt(accounts.revision, cursor)))
      .orderBy(asc(accounts.revision))
      .limit(limit + 1);
    const categoryRows = await tx
      .select()
      .from(categories)
      .where(and(inArray(categories.workspaceId, ids), gt(categories.revision, cursor)))
      .orderBy(asc(categories.revision))
      .limit(limit + 1);
    const transactionRows = await selectViewRows(tx)
      .where(and(inArray(transactions.workspaceId, ids), gt(transactions.revision, cursor)))
      .orderBy(asc(transactions.revision))
      .limit(limit + 1);
    // A row that moved back into a workspace the actor sees arrives live; its old tombstone must
    // not follow it.
    const tombstoneRows = await tx
      .select({
        id: syncTombstones.transactionId,
        workspaceId: syncTombstones.workspaceId,
        deletedAt: syncTombstones.deletedAt,
        revision: syncTombstones.revision,
      })
      .from(syncTombstones)
      .where(
        and(
          inArray(syncTombstones.workspaceId, ids),
          gt(syncTombstones.revision, cursor),
          not(
            exists(
              tx
                .select({ id: transactions.id })
                .from(transactions)
                .where(
                  and(
                    eq(transactions.id, syncTombstones.transactionId),
                    inArray(transactions.workspaceId, ids),
                  ),
                ),
            ),
          ),
        ),
      )
      .orderBy(asc(syncTombstones.revision))
      .limit(limit + 1);
    const [dataset] = await tx.select({ epoch: syncEpoch.epoch }).from(syncEpoch);
    const window = pullWindow(cursor, limit, [
      accountRows.map((r) => r.revision),
      categoryRows.map((r) => r.revision),
      transactionRows.map((r) => r.revision),
      tombstoneRows.map((r) => r.revision),
    ]);
    const upTo = <T extends { revision: number }>(rows: T[]) =>
      rows.filter((r) => r.revision <= window.cutoff);
    return {
      epoch: dataset!.epoch,
      workspaces: list.map((m) => ({
        id: m.workspaceId,
        kind: m.kind,
        name: m.name,
        role: m.role,
      })),
      accounts: upTo(accountRows).map(toView) satisfies AccountView[],
      categories: upTo(categoryRows).map(toView) satisfies CategoryView[],
      transactions: [
        ...upTo(transactionRows).map((row) => toLedgerRow(row, visible)),
        ...upTo(tombstoneRows).map((row): Tombstone => ({
          ...row,
          deletedAt: row.deletedAt.toISOString(),
        })),
      ].sort((a, b) => a.revision - b.revision),
      conflicts: await this.conflicts(actorId, tx),
      cursor: window.cutoff,
      hasMore: window.hasMore,
    };
  }

  /** Open conflicts of the actor on rows they can still see. */
  async conflicts(actorId: string, tx: Tx = this.db): Promise<ConflictView[]> {
    const rows = await tx
      .select()
      .from(syncConflicts)
      .where(and(eq(syncConflicts.userId, actorId), eq(syncConflicts.status, 'open')))
      .orderBy(desc(syncConflicts.createdAt));
    const views = await this.ledger.ledgerRows(
      tx,
      actorId,
      rows.map((r) => r.transactionId),
    );
    return rows.flatMap((row) => {
      const server = views.get(row.transactionId);
      if (!server) return [];
      return [
        {
          id: row.id,
          transactionId: row.transactionId,
          baseVersion: row.baseVersion,
          serverVersion: row.serverVersion,
          local: row.local as ConflictLocal,
          server,
          createdAt: row.createdAt.toISOString(),
        },
      ];
    });
  }

  /** BR-20. Applies the chosen side as a normal write on the current version; idempotent. */
  resolve(
    actorId: string,
    conflictId: string,
    resolution: 'server' | 'local' | 'merged',
    merged: TransactionInput | undefined,
  ) {
    return ledgerTransaction(this.db, async (tx) => {
      const [conflict] = await tx
        .select()
        .from(syncConflicts)
        .where(and(eq(syncConflicts.id, conflictId), eq(syncConflicts.userId, actorId)))
        .for('update');
      if (!conflict) throw new ApiError('NOT_FOUND');
      if (conflict.status === 'open') {
        if (resolution === 'merged' && merged?.id !== conflict.transactionId) {
          throw new ApiError('VALIDATION_FAILED', 'merged needs the conflicting transaction');
        }
        const local = resolution === 'merged' ? merged! : (conflict.local as ConflictLocal);
        if (resolution !== 'server') {
          const outcome =
            'deleted' in local
              ? await this.delete(tx, actorId, conflict.transactionId, 'current')
              : await this.upsert(tx, actorId, local, 'current');
          if (outcome.status === 'rejected') {
            throw new ApiError(outcome.code as RejectCode, outcome.message);
          }
        }
        await tx
          .update(syncConflicts)
          .set({ status: 'resolved', resolution, resolvedAt: sql`now()` })
          .where(eq(syncConflicts.id, conflictId));
      }
      const [closed] = await tx
        .select()
        .from(syncConflicts)
        .where(eq(syncConflicts.id, conflictId));
      const view = (await this.ledger.ledgerRows(tx, actorId, [conflict.transactionId])).get(
        conflict.transactionId,
      );
      if (!view) throw new ApiError('NOT_FOUND');
      return {
        id: closed!.id,
        status: 'resolved' as const,
        resolution: closed!.resolution!,
        resolvedAt: closed!.resolvedAt!.toISOString(),
        transaction: view,
      };
    });
  }

  private apply(tx: Tx, actorId: string, mutation: Mutation): Promise<Outcome> {
    return mutation.type === 'transaction.upsert'
      ? this.upsert(tx, actorId, mutation.transaction, mutation.baseVersion)
      : this.delete(tx, actorId, mutation.transactionId, mutation.baseVersion);
  }

  private async upsert(
    tx: Tx,
    actorId: string,
    input: TransactionInput,
    base: Base,
  ): Promise<Outcome> {
    const workspaces = new Set(
      (await this.policy.memberships(actorId, tx)).map((m) => m.workspaceId),
    );
    const loaded = await this.existing(tx, input.id);
    const existing = loaded?.row ?? null;
    const accountHidden =
      loaded?.accountWorkspaceId != null && !workspaces.has(loaded.accountWorkspaceId);
    const intended: IntendedFields = {
      workspaceId: input.workspaceId,
      kind: input.kind,
      amountMinor: input.amountMinor,
      currency: input.currency,
      occurredOn: input.occurredOn,
      accountId: effectiveAccountId(input, existing, accountHidden),
      categoryId: input.categoryId,
      description: input.description,
      note: input.note,
      transferId:
        input.transferId === undefined ? (existing?.transferId ?? null) : input.transferId,
      transferOutside:
        input.transferOutside === undefined
          ? (existing?.transferOutside ?? false)
          : input.transferOutside,
    };
    const authorId = existing ? existing.createdBy : actorId;
    const authorPersonalWorkspaceId = authorId
      ? await this.policy.personalWorkspaceId(authorId, tx)
      : null;
    const account = intended.accountId ? await this.accountFact(tx, intended.accountId) : null;
    const category = intended.categoryId ? await this.categoryFact(tx, intended.categoryId) : null;
    const transferPeers = intended.transferId
      ? await tx
          .select({
            workspaceId: transactions.workspaceId,
            kind: transactions.kind,
            transferOutside: transactions.transferOutside,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.transferId, intended.transferId),
              ne(transactions.id, input.id),
              isNull(transactions.deletedAt),
            ),
          )
      : [];
    const decision = decideUpsert({
      actorId,
      workspaces,
      intended,
      baseVersion: base === 'current' ? (existing?.version ?? null) : base,
      existing,
      authorPersonalWorkspaceId,
      account,
      category,
      transferPeers,
    });
    switch (decision.outcome) {
      case 'rejected':
        return rejected(decision.code);
      case 'unchanged':
        return { status: 'applied', transactionId: input.id };
      case 'conflict':
        return this.conflict(tx, actorId, input.id, base, existing!, input);
      case 'insert':
      case 'update': {
        const conversion = await this.fx.conversion(
          tx,
          intended.amountMinor,
          intended.currency as CurrencyCode,
          intended.occurredOn,
        );
        if (decision.outcome === 'insert') {
          await tx
            .insert(transactions)
            .values({ id: input.id, ...intended, ...conversion, createdBy: actorId });
        } else {
          const moved = existing!.workspaceId !== intended.workspaceId;
          await tx
            .update(transactions)
            .set({ ...intended, ...conversion, deletedAt: null })
            .where(eq(transactions.id, input.id));
          // Only the author moves rows, so other users' conflicts concern a row they lose.
          if (moved) {
            await tx
              .insert(syncTombstones)
              .values({ workspaceId: existing!.workspaceId, transactionId: input.id })
              .onConflictDoUpdate({
                target: [syncTombstones.workspaceId, syncTombstones.transactionId],
                set: { deletedAt: sql`now()` },
              });
            await tx
              .delete(syncConflicts)
              .where(
                and(eq(syncConflicts.transactionId, input.id), ne(syncConflicts.userId, actorId)),
              );
          }
          // BR-29: correcting an imported row's category teaches the next import.
          if (
            loaded!.source === 'import' &&
            intended.categoryId !== null &&
            intended.categoryId !== existing!.categoryId
          ) {
            await learnCategoryRules(tx, [
              {
                workspaceId: intended.workspaceId,
                description: existing!.description,
                categoryId: intended.categoryId,
              },
            ]);
          }
        }
        return { status: 'applied', transactionId: input.id };
      }
    }
  }

  private async delete(tx: Tx, actorId: string, id: string, base: DeleteBase): Promise<Outcome> {
    const workspaces = new Set(
      (await this.policy.memberships(actorId, tx)).map((m) => m.workspaceId),
    );
    const existing = (await this.existing(tx, id))?.row ?? null;
    const decision = decideDelete({
      workspaces,
      existing,
      baseVersion: base === 'current' ? (existing?.version ?? 0) : base,
    });
    switch (decision.outcome) {
      case 'rejected':
        return rejected(decision.code);
      case 'unchanged':
        return { status: 'applied', transactionId: id };
      case 'conflict':
        return this.conflict(tx, actorId, id, base, existing!, DELETED);
      case 'delete':
        await tx
          .update(transactions)
          .set({ deletedAt: sql`now()` })
          .where(eq(transactions.id, id));
        return { status: 'applied', transactionId: id };
    }
  }

  /** BR-19. The server row stays; the actor's open conflict for it holds the latest intent. */
  private async conflict(
    tx: Tx,
    actorId: string,
    transactionId: string,
    base: Base,
    existing: ExistingRow,
    local: ConflictLocal,
  ): Promise<Outcome> {
    const values = {
      baseVersion: typeof base === 'number' ? base : 0,
      serverVersion: existing.version,
      local,
    };
    const [row] = await tx
      .insert(syncConflicts)
      .values({ transactionId, userId: actorId, ...values })
      .onConflictDoUpdate({
        target: [syncConflicts.transactionId, syncConflicts.userId],
        targetWhere: sql`${syncConflicts.status} = 'open'`,
        set: { ...values, createdAt: sql`now()` },
      })
      .returning({ id: syncConflicts.id });
    return { status: 'conflict', conflictId: row!.id, transactionId };
  }

  private async present(
    tx: Tx,
    actorId: string,
    mutationId: string,
    outcome: Outcome,
  ): Promise<PushResult> {
    if (outcome.status === 'rejected') return { mutationId, ...outcome };
    const view = (await this.ledger.ledgerRows(tx, actorId, [outcome.transactionId])).get(
      outcome.transactionId,
    );
    if (!view) return { mutationId, status: 'rejected', code: 'NOT_FOUND', message: 'NOT_FOUND' };
    return outcome.status === 'applied'
      ? { mutationId, status: 'applied', transaction: view }
      : { mutationId, status: 'conflict', conflictId: outcome.conflictId, transaction: view };
  }

  private async existing(
    tx: Tx,
    id: string,
  ): Promise<{
    row: ExistingRow;
    accountWorkspaceId: string | null;
    source: typeof transactions.$inferSelect.source;
  } | null> {
    const [found] = await tx
      .select({
        row: existingColumns,
        accountWorkspaceId: accounts.workspaceId,
        source: transactions.source,
      })
      .from(transactions)
      .leftJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(eq(transactions.id, id))
      .for('update', { of: transactions });
    return found ?? null;
  }

  private async accountFact(tx: Tx, id: string) {
    const [row] = await tx
      .select({ workspaceId: accounts.workspaceId, archivedAt: accounts.archivedAt })
      .from(accounts)
      .where(eq(accounts.id, id));
    return row ? { workspaceId: row.workspaceId, archived: row.archivedAt !== null } : null;
  }

  private async categoryFact(tx: Tx, id: string) {
    const [row] = await tx
      .select({
        workspaceId: categories.workspaceId,
        kind: categories.kind,
        archivedAt: categories.archivedAt,
      })
      .from(categories)
      .where(eq(categories.id, id));
    return row
      ? { workspaceId: row.workspaceId, kind: row.kind, archived: row.archivedAt !== null }
      : null;
  }
}

const STARTUP_DELAY_MS = 60_000;
const INTERVAL_MS = 24 * 60 * 60_000;

/** Prunes old mutation outcomes shortly after startup and daily. Off in tests, which call it. */
@Injectable()
export class SyncScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Sync');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SyncService) private readonly sync: SyncService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.env === 'test') return;
    this.timers = [
      setTimeout(() => void this.run(), STARTUP_DELAY_MS).unref(),
      setInterval(() => void this.run(), INTERVAL_MS).unref(),
    ];
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) clearTimeout(timer);
  }

  private async run(): Promise<void> {
    try {
      this.logger.log(`sync_mutations_pruned count=${await this.sync.pruneMutations()}`);
    } catch (error) {
      this.logger.warn(`sync_prune_failed ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
}
