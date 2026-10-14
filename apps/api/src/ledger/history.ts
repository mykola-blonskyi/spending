import { z } from 'zod';
import { WORKSPACE_KINDS } from '../workspaces/family';
import { calendarDateSchema, ENTRY_KINDS, REVIEW_STATUSES } from './views';

export const HISTORY_PAGE_MAX = 200;

export const transactionQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(200).optional(),
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  kind: z.enum(ENTRY_KINDS).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  scope: z.enum(WORKSPACE_KINDS).optional(),
  workspaceId: z.uuid().optional(),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(HISTORY_PAGE_MAX).default(50),
});
export type TransactionQuery = z.infer<typeof transactionQuerySchema>;

/** Position after the last row of a page, in history order (occurredOn, createdAt, id; all desc). */
export type HistoryCursor = Readonly<{ occurredOn: string; createdAt: string; id: string }>;

/** `createdAt` keeps the microseconds PostgreSQL stores, which a JS Date would drop. */
const microsecondInstant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
const cursorSchema = z.tuple([calendarDateSchema, microsecondInstant, z.uuid()]);

export function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify([cursor.occurredOn, cursor.createdAt, cursor.id])).toString(
    'base64url',
  );
}

/** Returns null for anything this server did not issue. */
export function decodeCursor(text: string): HistoryCursor | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(text, 'base64url').toString()));
    if (!parsed.success || Number.isNaN(Date.parse(parsed.data[1]))) return null;
    const [occurredOn, createdAt, id] = parsed.data;
    return { occurredOn, createdAt, id };
  } catch {
    return null;
  }
}

/** Makes user text match literally inside ILIKE, whose escape character is the backslash. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}
