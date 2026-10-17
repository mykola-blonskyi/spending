import { z } from 'zod';
import { importBatches } from '../database/schema';
import { transactionViewSchema } from '../ledger/views';
import { WORKSPACE_KINDS } from '../workspaces/family';
import {
  bankCategorySchema,
  IMPORT_ROWS_MAX,
  importRowSchema,
  MAPPING_MAX_BYTES,
  REJECT_REASONS,
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

const importBatchViewSchema = z
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

const transferSuggestionFields = {
  /** Null: a transfer to or from an own account outside the app. */
  counterpartId: z.uuid().nullable(),
  reason: z.enum(['keyword', 'counterpart']),
};

const rejectedRowSchema = z.object({ line: z.int(), reason: z.enum(REJECT_REASONS) });

export const importResultSchema = z.object({
  batch: importBatchViewSchema,
  imported: z.object({
    count: z.int(),
    transactionIds: z.array(z.uuid()),
    /** The bank category of each imported row that had one, for the browser to send back. */
    bankCategories: z.record(z.uuid(), z.string()),
    /** BR-38: rows that look like own transfers, for the user to confirm. Never stored. */
    transferSuggestions: z.array(
      z.object({ transactionId: z.uuid(), ...transferSuggestionFields }),
    ),
  }),
  duplicates: z.int(),
  rejected: z.array(rejectedRowSchema),
});

export const batchListSchema = z.object({ batches: z.array(importBatchViewSchema) });

export const undoResultSchema = z.object({
  batch: importBatchViewSchema,
  deleted: z.int(),
  kept: z.int(),
});

export const clearResultSchema = z.object({ removed: z.int() });

export const reviewListSchema = z.object({
  items: z.array(
    z.object({
      transaction: transactionViewSchema,
      // The transaction's own categoryId is the personal suggestion.
      familyCategoryId: z.uuid().nullable(),
      /** BR-38: the counterpart may be another row of this list, which then points back. */
      transferSuggestion: z.object(transferSuggestionFields).optional(),
    }),
  ),
});

export const confirmBodySchema = z.strictObject({
  items: z
    .array(
      z
        .strictObject({
          transactionId: z.uuid(),
          scope: z.enum(WORKSPACE_KINDS),
          categoryId: z.uuid().nullable(),
          bankCategory: bankCategorySchema.optional(),
          /** BR-38: confirm as a transfer; null links it to an own account outside the app. */
          transfer: z.strictObject({ counterpartId: z.uuid().nullable() }).optional(),
        })
        .refine(
          (item) => !item.transfer || (item.scope === 'personal' && item.categoryId === null),
          'a transfer is personal and has no category',
        ),
    )
    .min(1)
    .max(500)
    .refine(
      (items) => new Set(items.map((i) => i.transactionId)).size === items.length,
      'each transaction may appear once',
    ),
});
export type ConfirmItem = z.infer<typeof confirmBodySchema>['items'][number];

/** BR-29: categories chosen on the import summary, with the bank category the browser still holds. */
export const learnBodySchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        transactionId: z.uuid(),
        categoryId: z.uuid(),
        bankCategory: bankCategorySchema,
      }),
    )
    .min(1)
    .max(500),
});
export type LearnItem = z.infer<typeof learnBodySchema>['items'][number];

export const confirmResultSchema = z.object({ transactions: z.array(transactionViewSchema) });

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
