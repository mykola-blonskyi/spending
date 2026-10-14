import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ApiError } from '../common/errors';
import { BASE_CURRENCY, type CurrencyCode } from '../common/money';
import { DB, type Db, ledgerTransaction, type Tx } from '../database/database.module';
import { accounts, importBatches, transactions } from '../database/schema';
import { convert } from '../ledger/fx/conversion';
import { FxService } from '../ledger/fx/fx.service';
import { AccessPolicy } from '../workspaces/access-policy';
import { importHashes } from './dedupe';
import { type NormalizedRow, validateRows } from './rows';
import { batchColumns, type ImportBody, type ImportResult, toBatchView } from './schemas';

/** Keeps one multi-row insert well under PostgreSQL's 65535 bind parameters. */
const INSERT_CHUNK = 500;

@Injectable()
export class ImportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AccessPolicy) private readonly policy: AccessPolicy,
    @Inject(FxService) private readonly fx: FxService,
  ) {}

  /** BR-26. Imports land in the actor's personal workspace; one transaction holds the batch. */
  create(actorId: string, body: ImportBody): Promise<ImportResult> {
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
      const values = [];
      for (const [index, row] of valid.entries()) {
        values.push({
          id: crypto.randomUUID(),
          workspaceId,
          createdBy: actorId,
          kind: row.kind,
          amountMinor: row.amountMinor,
          currency: row.currency,
          occurredOn: row.occurredOn,
          accountId: account.id,
          description: row.description,
          externalId: row.externalId,
          importHash: hashes[index]!,
          source: 'import' as const,
          importBatchId: batch!.id,
          ...(await this.conversion(tx, row)),
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
        imported: { count: transactionIds.length, transactionIds },
        duplicates,
        rejected,
      };
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

  /** EUR needs no rate lookup; other currencies read the rate inside this transaction (BR-14). */
  private conversion(tx: Tx, row: NormalizedRow) {
    return row.currency === BASE_CURRENCY
      ? convert(row.amountMinor, row.currency, null)
      : this.fx.conversion(tx, row.amountMinor, row.currency, row.occurredOn);
  }
}
