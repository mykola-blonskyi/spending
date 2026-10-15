import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { exportSection } from '../data-rights/export-section';
import { categoryRules, importBatches } from '../database/schema';

const importBatchExportSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  accountId: z.uuid().nullable(),
  fileName: z.string(),
  mapping: z.unknown(),
  rowCount: z.int(),
  importedCount: z.int(),
  duplicateCount: z.int(),
  rejectedCount: z.int(),
  rejected: z.array(z.object({ row: z.int(), reason: z.string() })),
  createdAt: z.iso.datetime(),
  undoneAt: z.iso.datetime().nullable(),
});

const categoryRuleExportSchema = z.object({
  workspaceId: z.uuid(),
  merchantKey: z.string(),
  categoryId: z.uuid(),
  updatedAt: z.iso.datetime(),
});

/** Batches live in their importer's personal workspace; only the actor's own are exported. */
export const importBatchesExport = exportSection({
  schema: z.array(importBatchExportSchema),
  async read(tx, scope) {
    const rows = await tx
      .select()
      .from(importBatches)
      .where(eq(importBatches.userId, scope.actorId))
      .orderBy(importBatches.createdAt, importBatches.id);
    return rows.map(({ userId: _userId, ...row }) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      undoneAt: row.undoneAt?.toISOString() ?? null,
    }));
  },
});

export const categoryRulesExport = exportSection({
  schema: z.array(categoryRuleExportSchema),
  async read(tx, scope) {
    const rows = await tx
      .select()
      .from(categoryRules)
      .where(inArray(categoryRules.workspaceId, [...scope.visible]))
      .orderBy(categoryRules.workspaceId, categoryRules.merchantKey);
    return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
  },
});
