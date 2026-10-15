import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { exportSection } from '../data-rights/export-section';
import { accounts, categories, transactions } from '../database/schema';
import { accountColumns, categoryColumns, selectViewRows } from './ledger.service';
import {
  accountViewSchema,
  categoryViewSchema,
  toView,
  toLedgerRow,
  type TransactionView,
  transactionViewSchema,
} from './views';

export const accountsExport = exportSection({
  schema: z.array(accountViewSchema),
  async read(tx, scope) {
    const rows = await tx
      .select(accountColumns)
      .from(accounts)
      .where(inArray(accounts.workspaceId, [...scope.visible]))
      .orderBy(accounts.createdAt, accounts.id);
    return rows.map(toView);
  },
});

export const categoriesExport = exportSection({
  schema: z.array(categoryViewSchema),
  async read(tx, scope) {
    const rows = await tx
      .select(categoryColumns)
      .from(categories)
      .where(inArray(categories.workspaceId, [...scope.visible]))
      .orderBy(categories.workspaceId, categories.kind, categories.name, categories.id);
    return rows.map(toView);
  },
});

/**
 * Every live transaction the actor sees, oldest first: confirmed rows of their workspaces plus
 * pending-review rows of their personal workspace (BR-21). No tombstones (BR-16). An account
 * outside the actor's workspaces reads as null (BR-3).
 */
export const transactionsExport = exportSection({
  schema: z.array(transactionViewSchema),
  async read(tx, scope) {
    const rows = await selectViewRows(tx)
      .where(
        and(
          inArray(transactions.workspaceId, [...scope.visible]),
          isNull(transactions.deletedAt),
          or(
            eq(transactions.reviewStatus, 'confirmed'),
            eq(transactions.workspaceId, scope.personalWorkspaceId),
          ),
        ),
      )
      .orderBy(asc(transactions.occurredOn), asc(transactions.createdAt), asc(transactions.id));
    return rows.map((row) => toLedgerRow(row, scope.visible) as TransactionView);
  },
});
