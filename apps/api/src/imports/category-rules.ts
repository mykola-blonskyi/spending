import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../database/database.module';
import { categories, categoryRules } from '../database/schema';
import { type CategoryCatalog, merchantKey } from './categorize';

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

/**
 * BR-29: a user chose `categoryId` for an imported row with this description. The caller has
 * already checked that the category belongs to `workspaceId`.
 */
export async function learnCategoryRule(
  tx: Tx,
  workspaceId: string,
  description: string,
  categoryId: string,
): Promise<void> {
  const key = merchantKey(description);
  if (key === '') return;
  // shortcut: one learned rule per merchant regardless of kind, so a refund can replace the expense
  // rule; key by (merchant, kind) if that shows up in practice.
  await tx
    .insert(categoryRules)
    .values({ workspaceId, merchantKey: key, categoryId })
    .onConflictDoUpdate({
      target: [categoryRules.workspaceId, categoryRules.merchantKey],
      set: { categoryId, updatedAt: sql`now()` },
    });
}
