import { z } from 'zod';
import { type CurrencyCode, parseCurrency } from '../common/money';
import {
  amountMinorSchema,
  calendarDateSchema,
  DESCRIPTION_MAX,
  type EntryKind,
} from '../ledger/views';

export const IMPORT_ROWS_MAX = 5000;
const EXTERNAL_ID_MAX = 100;
export const MAPPING_MAX_BYTES = 4096;

/** BR-29: the bank's own category text, sent by the browser and never stored. */
export const bankCategorySchema = z.string().max(100);

export const REJECT_REASONS = [
  'INVALID_DATE',
  'INVALID_AMOUNT',
  'INVALID_CURRENCY',
  'DESCRIPTION_TOO_LONG',
  'EXTERNAL_ID_TOO_LONG',
  'DUPLICATE_IN_FILE_EXTERNAL_ID',
] as const;
type RejectReason = (typeof REJECT_REASONS)[number];
export type RejectedRow = Readonly<{ line: number; reason: RejectReason }>;

/**
 * A row as the browser normalized it. Field types are loose on purpose: a bad value rejects that
 * row with a reason code (BR-26) instead of failing the whole request.
 */
export const importRowSchema = z.strictObject({
  line: z.int().min(1),
  occurredOn: z.string(),
  amountMinor: z.number(),
  currency: z.string().optional(),
  description: z.string(),
  externalId: z.string().optional(),
  // Category hints (BR-29): validated here, so a bad value fails the request, not one row.
  bankCategory: bankCategorySchema.optional(),
  mcc: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
});
export type ImportRowInput = z.infer<typeof importRowSchema>;

/** A row that passed validation, as it will be stored. */
export type NormalizedRow = Readonly<{
  line: number;
  occurredOn: string;
  kind: EntryKind;
  amountMinor: number;
  currency: CurrencyCode;
  description: string;
  externalId: string | null;
  bankCategory?: string;
  mcc?: string;
}>;

type Checked = { row: NormalizedRow } | { reason: RejectReason };

function checkRow(input: ImportRowInput, accountCurrency: CurrencyCode): Checked {
  if (!calendarDateSchema.safeParse(input.occurredOn).success) return { reason: 'INVALID_DATE' };
  const amount = input.amountMinor;
  if (!amountMinorSchema.safeParse(Math.abs(amount)).success) return { reason: 'INVALID_AMOUNT' };
  const currency = input.currency === undefined ? accountCurrency : parseCurrency(input.currency);
  if (!currency) return { reason: 'INVALID_CURRENCY' };
  const description = input.description.trim();
  if (description.length > DESCRIPTION_MAX) return { reason: 'DESCRIPTION_TOO_LONG' };
  const externalId = input.externalId?.trim() || null;
  if (externalId && externalId.length > EXTERNAL_ID_MAX) return { reason: 'EXTERNAL_ID_TOO_LONG' };
  return {
    row: {
      line: input.line,
      occurredOn: input.occurredOn,
      kind: amount < 0 ? 'expense' : 'income',
      amountMinor: Math.abs(amount),
      currency,
      description,
      externalId,
      bankCategory: input.bankCategory,
      mcc: input.mcc,
    },
  };
}

/** BR-26. Splits the file into rows to store, in file order, and rejected rows with reasons. */
export function validateRows(
  rows: readonly ImportRowInput[],
  accountCurrency: CurrencyCode,
): { valid: NormalizedRow[]; rejected: RejectedRow[] } {
  const valid: NormalizedRow[] = [];
  const rejected: RejectedRow[] = [];
  const externalIds = new Set<string>();
  for (const input of rows) {
    const checked = checkRow(input, accountCurrency);
    if ('reason' in checked) {
      rejected.push({ line: input.line, reason: checked.reason });
    } else if (checked.row.externalId !== null && externalIds.has(checked.row.externalId)) {
      rejected.push({ line: input.line, reason: 'DUPLICATE_IN_FILE_EXTERNAL_ID' });
    } else {
      if (checked.row.externalId !== null) externalIds.add(checked.row.externalId);
      valid.push(checked.row);
    }
  }
  return { valid, rejected };
}
