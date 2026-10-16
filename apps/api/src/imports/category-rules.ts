import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../database/database.module';
import { categories, categoryRules, importHints } from '../database/schema';
import { bankCategoryKey, type CategoryCatalog, merchantKey } from './categorize';

/** Learned rules and default categories of one workspace; archived categories are skipped. */
export async function loadCatalog(tx: Tx, workspaceId: string): Promise<CategoryCatalog> {
  const learned = await tx
    .select({ key: categoryRules.merchantKey, id: categories.id, kind: categories.kind })
    .from(categoryRules)
    .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
    .where(
      and(
        eq(categoryRules.workspaceId, workspaceId),
        eq(categories.workspaceId, workspaceId),
        isNull(categories.archivedAt),
      ),
    );
  const defaults = await tx
    .select({ key: categories.systemKey, id: categories.id, kind: categories.kind })
    .from(categories)
    .where(
      and(
        eq(categories.workspaceId, workspaceId),
        isNotNull(categories.systemKey),
        isNull(categories.archivedAt),
      ),
    );
  return {
    learned: new Map(learned.map((r) => [r.key, { id: r.id, kind: r.kind }])),
    bySystemKey: new Map(defaults.map((r) => [r.key!, { id: r.id, kind: r.kind }])),
  };
}

/** The folded bank category kept for each of these imported transactions, by id. */
export async function loadBankCategories(
  tx: Tx,
  transactionIds: readonly string[],
): Promise<Map<string, string>> {
  if (transactionIds.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(importHints)
    .where(inArray(importHints.transactionId, [...transactionIds]));
  return new Map(rows.map((r) => [r.transactionId, r.bankCategory]));
}

/**
 * BR-29: a user chose `categoryId` for an imported row with this description. The caller has
 * already checked that each category belongs to its `workspaceId`. A later rule for the same
 * merchant wins, as if the rules were learned one by one.
 */
export async function learnCategoryRules(
  tx: Tx,
  rules: readonly {
    workspaceId: string;
    description: string;
    categoryId: string;
    /** The row's folded bank category, when it came with one: learned as a rule of its own. */
    bankCategory?: string;
  }[],
): Promise<void> {
  const byKey = new Map<string, { workspaceId: string; merchantKey: string; categoryId: string }>();
  for (const { workspaceId, description, categoryId, bankCategory } of rules) {
    for (const key of [
      merchantKey(description),
      bankCategory ? bankCategoryKey(bankCategory) : '',
    ]) {
      if (key !== '')
        byKey.set(`${workspaceId}:${key}`, { workspaceId, merchantKey: key, categoryId });
    }
  }
  if (byKey.size === 0) return;
  // shortcut: one learned rule per merchant regardless of kind, so a refund can replace the expense
  // rule; key by (merchant, kind) if that shows up in practice.
  await tx
    .insert(categoryRules)
    .values([...byKey.values()])
    .onConflictDoUpdate({
      target: [categoryRules.workspaceId, categoryRules.merchantKey],
      set: { categoryId: sql`excluded.category_id`, updatedAt: sql`now()` },
    });
}
