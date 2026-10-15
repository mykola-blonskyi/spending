import { z } from 'zod';
import { importBatches } from '../database/schema';
import {
  IMPORT_ROWS_MAX,
  importRowSchema,
  MAPPING_MAX_BYTES,
  REJECT_REASONS,
  type RejectedRow,
} from './rows';

export const importBodySchema = z.strictObject({
  accountId: z.uuid(),
  fileName: z.string().trim().min(1).max(200),
  mapping: z
    .record(z.string(), z.unknown())
    .refine(
      (value) => Buffer.byteLength(JSON.stringify(value)) <= MAPPING_MAX_BYTES,
      `must serialize to at most ${MAPPING_MAX_BYTES} bytes`,
    ),
  rows: z.array(importRowSchema).min(1).max(IMPORT_ROWS_MAX),
});
export type ImportBody = z.infer<typeof importBodySchema>;

export const importBatchViewSchema = z
  .object({
    id: z.uuid(),
    accountId: z.uuid().nullable(),
    fileName: z.string(),
    rowCount: z.int(),
    importedCount: z.int(),
    duplicateCount: z.int(),
    rejectedCount: z.int(),
    createdAt: z.iso.datetime(),
    undoneAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'ImportBatchView' });
export type ImportBatchView = z.infer<typeof importBatchViewSchema>;

const rejectedRowSchema = z.object({ line: z.int(), reason: z.enum(REJECT_REASONS) });

export const importResultSchema = z.object({
  batch: importBatchViewSchema,
  imported: z.object({ count: z.int(), transactionIds: z.array(z.uuid()) }),
  duplicates: z.int(),
  rejected: z.array(rejectedRowSchema),
});
export type ImportResult = {
  batch: ImportBatchView;
  imported: { count: number; transactionIds: string[] };
  duplicates: number;
  rejected: RejectedRow[];
};

export const batchListSchema = z.object({ batches: z.array(importBatchViewSchema) });

export const undoResultSchema = z.object({
  batch: importBatchViewSchema,
  deleted: z.int(),
  kept: z.int(),
});

export const batchColumns = {
  id: importBatches.id,
  accountId: importBatches.accountId,
  fileName: importBatches.fileName,
  rowCount: importBatches.rowCount,
  importedCount: importBatches.importedCount,
  duplicateCount: importBatches.duplicateCount,
  rejectedCount: importBatches.rejectedCount,
  createdAt: importBatches.createdAt,
  undoneAt: importBatches.undoneAt,
};

type BatchRow = Omit<ImportBatchView, 'createdAt' | 'undoneAt'> & {
  createdAt: Date;
  undoneAt: Date | null;
};

export const toBatchView = (row: BatchRow): ImportBatchView => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  undoneAt: row.undoneAt?.toISOString() ?? null,
});
