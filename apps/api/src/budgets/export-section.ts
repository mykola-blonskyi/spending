import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { ExportSection } from '../data-rights/export-section';
import { budgets } from '../database/schema';

const budgetExportSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  categoryId: z.uuid(),
  amountMinor: z.int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const budgetsExport = {
  schema: z.array(budgetExportSchema),
  async read(tx, scope) {
    const rows = await tx
      .select()
      .from(budgets)
      .where(inArray(budgets.workspaceId, [...scope.visible]))
      .orderBy(budgets.createdAt, budgets.id);
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  },
} satisfies ExportSection<z.ZodType>;
