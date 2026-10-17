import type { DataExport } from '@data/data-rights';
import { currencyExponent, minorToDecimalString } from '@shared/format';

/** Leading characters a spreadsheet may evaluate as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * One RFC 4180 field. A value a spreadsheet would run as a formula gets a leading `'`, so an
 * exported description such as `=HYPERLINK(...)` stays text.
 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export const csvRow = (cells: readonly string[]): string => `${cells.map(csvCell).join(',')}\r\n`;

const COLUMNS = [
  'date',
  'kind',
  'amount',
  'currency',
  'eurAmount',
  'fxRate',
  'fxRateDate',
  'scope',
  'workspace',
  'account',
  'category',
  'description',
  'note',
  'source',
  'author',
  'transfer',
] as const;
type CsvColumn = (typeof COLUMNS)[number];

type Names = {
  header: (column: CsvColumn) => string;
  category: (category: DataExport['categories'][number]) => string;
  formerMember: string;
};

/**
 * The confirmed transactions of an export as CSV (BR-31), one row each, oldest first. Amounts are
 * unsigned major units ("kind" carries the sign, BR-13). Names resolve through the export's own
 * sections, so an account the actor cannot see stays empty (BR-3). "transfer" is the id both sides
 * of a transfer share, or `outside` for a one-sided transfer (BR-37).
 */
export function transactionsCsv(document: DataExport, names: Names): string {
  const workspaces = new Map(document.workspaces.map((w) => [w.id, w.name ?? '']));
  const accounts = new Map(document.accounts.map((a) => [a.id, a.name]));
  const categories = new Map(document.categories.map((c) => [c.id, names.category(c)]));
  const eurExponent = currencyExponent('EUR');
  const lines = [csvRow(COLUMNS.map(names.header))];
  for (const t of document.transactions) {
    if (t.reviewStatus !== 'confirmed') continue;
    lines.push(
      csvRow([
        t.occurredOn,
        t.kind,
        minorToDecimalString(t.amountMinor, currencyExponent(t.currency)),
        t.currency,
        t.baseAmountMinor === null ? '' : minorToDecimalString(t.baseAmountMinor, eurExponent),
        t.fx?.rate ?? '',
        t.fx?.rateDate ?? '',
        t.scope,
        workspaces.get(t.workspaceId) ?? '',
        (t.accountId && accounts.get(t.accountId)) ?? '',
        (t.categoryId && categories.get(t.categoryId)) ?? '',
        t.description,
        t.note,
        t.source,
        t.author.userId === null ? names.formerMember : (t.author.displayName ?? ''),
        t.transferOutside ? 'outside' : (t.transferId ?? ''),
      ]),
    );
  }
  return lines.join('');
}
