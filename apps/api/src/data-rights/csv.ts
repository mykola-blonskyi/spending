import { BASE_CURRENCY, currencyExponent, formatMinor } from '../common/money';
import type { DataExport } from './export-sections';

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

const HEADER = [
  'date',
  'kind',
  'amount',
  'currency',
  'eur_amount',
  'fx_rate',
  'fx_rate_date',
  'scope',
  'workspace',
  'account',
  'category',
  'description',
  'note',
  'source',
  'author',
] as const;

const FORMER_MEMBER = {
  en: 'former member',
  uk: 'колишній учасник',
  ru: 'бывший участник',
  es: 'antiguo miembro',
} as const;

/**
 * The confirmed transactions of an export as CSV (BR-31), one row each, oldest first. Amounts are
 * unsigned major units ("kind" carries the sign, BR-13). Names resolve through the export's own
 * sections, so an account the actor cannot see stays empty (BR-3). A former member's rows read
 * "former member" in the actor's locale.
 */
export function transactionsCsv(document: DataExport): string {
  const names = (rows: readonly { id: string; name: string }[]) =>
    new Map(rows.map((row) => [row.id, row.name]));
  const workspaces = names(document.workspaces);
  const accounts = names(document.accounts);
  const categories = names(document.categories);
  const formerMember = FORMER_MEMBER[document.user.locale];
  const eurExponent = currencyExponent(BASE_CURRENCY);
  const lines = [csvRow(HEADER)];
  for (const t of document.transactions) {
    if (t.reviewStatus !== 'confirmed') continue;
    lines.push(
      csvRow([
        t.occurredOn,
        t.kind,
        formatMinor(t.amountMinor, currencyExponent(t.currency)),
        t.currency,
        t.baseAmountMinor === null ? '' : formatMinor(t.baseAmountMinor, eurExponent),
        t.fx?.rate ?? '',
        t.fx?.rateDate ?? '',
        t.scope,
        workspaces.get(t.workspaceId) ?? '',
        (t.accountId && accounts.get(t.accountId)) ?? '',
        (t.categoryId && categories.get(t.categoryId)) ?? '',
        t.description,
        t.note,
        t.source,
        t.author.userId === null ? formerMember : (t.author.displayName ?? ''),
      ]),
    );
  }
  return lines.join('');
}
