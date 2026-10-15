import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { exportSection } from '../data-rights/export-section';
import { syncConflicts, transactions } from '../database/schema';
import { type ConflictLocal, conflictLocalSchema } from './mutations';

const conflictExportSchema = z.object({
  id: z.uuid(),
  transactionId: z.uuid(),
  local: conflictLocalSchema,
  createdAt: z.iso.datetime(),
});

/** The actor's open conflicts on rows they can still see: their unsaved versions (BR-19). */
export const conflictsExport = exportSection({
  schema: z.array(conflictExportSchema),
  async read(tx, scope) {
    const rows = await tx
      .select({
        id: syncConflicts.id,
        transactionId: syncConflicts.transactionId,
        local: syncConflicts.local,
        createdAt: syncConflicts.createdAt,
      })
      .from(syncConflicts)
      .innerJoin(transactions, eq(transactions.id, syncConflicts.transactionId))
      .where(
        and(
          eq(syncConflicts.userId, scope.actorId),
          eq(syncConflicts.status, 'open'),
          inArray(transactions.workspaceId, [...scope.visible]),
        ),
      )
      .orderBy(syncConflicts.createdAt, syncConflicts.id);
    return rows.map((row) => ({
      ...row,
      local: row.local as ConflictLocal,
      createdAt: row.createdAt.toISOString(),
    }));
  },
});
