import { createHash } from 'node:crypto';
import type { NormalizedRow } from './rows';

/** NFKC, lowercase, whitespace collapsed: the same bank text always gives the same key. */
export function normalizeDescription(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * BR-27, one hash per row in file order. A provider id is the key on its own. Otherwise the key
 * is the row's tuple plus how many identical tuples came earlier in the file, so a re-import
 * matches row for row while two identical purchases in one statement stay distinct.
 */
export function importHashes(accountId: string, rows: readonly NormalizedRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    if (row.externalId !== null) return sha256(`ext:${accountId}:${row.externalId}`);
    const signed = row.kind === 'expense' ? -row.amountMinor : row.amountMinor;
    const tuple = `row:${accountId}:${row.occurredOn}:${signed}:${row.currency}:${normalizeDescription(row.description)}`;
    const ordinal = seen.get(tuple) ?? 0;
    seen.set(tuple, ordinal + 1);
    return sha256(`${tuple}:${ordinal}`);
  });
}
