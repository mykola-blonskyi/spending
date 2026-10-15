/**
 * From statement columns to the rows `POST /imports` takes. Dates and amounts are parsed
 * exactly; a cell that cannot be read is sent in a form the server rejects with a reason
 * (BR-26), so every rejection is reported in one place with its line number.
 */
import type { ImportRow } from '@data/imports';

export const DATE_FORMATS = ['dmy', 'ymd', 'mdy'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export type DecimalSeparator = '.' | ',';

export type Columns = {
  date: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  description: number | null;
  externalId: number | null;
  currency: number | null;
};
export type AmountLayout = 'signed' | 'split';

export type Mapping = {
  preset: PresetId;
  columns: Columns;
  amountLayout: AmountLayout;
  dateFormat: DateFormat;
  decimal: DecimalSeparator;
};

export const PRESET_IDS = ['custom'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

type Headers = Partial<Record<keyof Columns, readonly string[]>>;

const GENERIC: Headers = {
  date: ['date', 'fecha', 'дата'],
  description: ['description', 'concepto', 'concept', 'memo', 'опис', 'описание'],
  amount: ['amount', 'importe', 'сумма', 'сума'],
  debit: ['debit', 'cargo', 'débito', 'debito', 'withdrawal'],
  credit: ['credit', 'abono', 'crédito', 'credito', 'deposit'],
  externalId: ['id', 'reference', 'referencia', 'transaction id'],
  currency: ['currency', 'divisa', 'moneda', 'валюта'],
};

const normalizeHeader = (header: string) => header.trim().toLowerCase();

function matchColumns(headers: readonly string[], names: Headers): Columns {
  const lower = headers.map(normalizeHeader);
  const find = (candidates: readonly string[] | undefined) => {
    for (const name of candidates ?? []) {
      const index = lower.indexOf(name);
      if (index >= 0) return index;
    }
    return null;
  };
  return {
    date: find(names.date),
    amount: find(names.amount),
    debit: find(names.debit),
    credit: find(names.credit),
    description: find(names.description),
    externalId: find(names.externalId),
    currency: find(names.currency),
  };
}

export function detectPreset(): PresetId {
  return 'custom';
}

/** A full mapping guessed from common header names. */
export function presetMapping(preset: PresetId, headers: readonly string[]): Mapping {
  const columns = matchColumns(headers, GENERIC);
  return {
    preset,
    columns,
    amountLayout: columns.amount === null && columns.debit !== null ? 'split' : 'signed',
    dateFormat: 'ymd',
    decimal: '.',
  };
}

const DATE_PATTERNS: Record<DateFormat, RegExp> = {
  dmy: /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/,
  mdy: /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/,
  ymd: /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/,
};

/** `YYYY-MM-DD` for a real calendar date in the format, else null. */
export function parseDate(text: string, format: DateFormat): string | null {
  const match = DATE_PATTERNS[format].exec(text.trim());
  if (!match) return null;
  const parts = match.slice(1).map(Number) as [number, number, number];
  const [year, month, day] =
    format === 'ymd'
      ? parts
      : format === 'dmy'
        ? [parts[2], parts[1], parts[0]]
        : [parts[2], parts[0], parts[1]];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The API's exact parser: "1.234,56", "-12.5", "1 234.5" to signed minor units. Grouping
 * characters are accepted only between groups of three digits, so a wrong separator choice fails
 * ("12,50" with "." as decimal) instead of scaling the amount. Null for anything else.
 */
export function parseAmountToMinor(
  text: string,
  exponent: number,
  decimalSeparator: DecimalSeparator,
): number | null {
  const groupChars = decimalSeparator === ',' ? ". \\u00a0\\u202f'" : ", \\u00a0\\u202f'";
  const match = new RegExp(
    `^([+-]?)(\\d{1,3}(?:([${groupChars}])\\d{3}(?:\\3\\d{3})*)?|\\d+)(?:\\${decimalSeparator}(\\d+))?$`,
  ).exec(text.trim());
  if (!match) return null;
  const integer = match[2]!.replace(/\D/g, '');
  const fraction = match[4] ?? '';
  if (fraction.length > exponent) return null;
  const minor = BigInt(integer + fraction.padEnd(exponent, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(match[1] === '-' ? -minor : minor);
}

export type NormalizedRow = ImportRow & {
  /** Which cells could not be read; the server will reject the row for the same reason. */
  problems: ('date' | 'amount')[];
};

const cellAt = (cells: readonly string[], index: number | null) =>
  index === null ? '' : (cells[index] ?? '');

/** Debit and credit columns hold unsigned amounts: money out is negative. */
function readAmount(cells: readonly string[], mapping: Mapping, exponent: number): number | null {
  const { columns, decimal } = mapping;
  if (mapping.amountLayout === 'signed') {
    return parseAmountToMinor(cellAt(cells, columns.amount), exponent, decimal);
  }
  const debit = cellAt(cells, columns.debit);
  const credit = cellAt(cells, columns.credit);
  const credited = credit === '' ? 0 : parseAmountToMinor(credit, exponent, decimal);
  const debited = debit === '' ? 0 : parseAmountToMinor(debit, exponent, decimal);
  if (credited === null || debited === null) return null;
  return Math.abs(credited) - Math.abs(debited);
}

/**
 * `exponentOf` gives the minor-unit digits for the row's currency cell ('' when no currency
 * column is mapped, meaning the account's currency).
 */
export function normalizeRow(
  row: { line: number; cells: readonly string[] },
  mapping: Mapping,
  exponentOf: (currency: string) => number,
): NormalizedRow {
  const { columns } = mapping;
  const problems: NormalizedRow['problems'] = [];
  const rawDate = cellAt(row.cells, columns.date);
  const occurredOn = parseDate(rawDate, mapping.dateFormat);
  if (occurredOn === null) problems.push('date');
  const currency = cellAt(row.cells, columns.currency);
  const amountMinor = readAmount(row.cells, mapping, exponentOf(currency));
  if (amountMinor === null || amountMinor === 0) problems.push('amount');
  const externalId = cellAt(row.cells, columns.externalId);
  return {
    line: row.line,
    occurredOn: occurredOn ?? rawDate,
    amountMinor: amountMinor ?? 0,
    description: cellAt(row.cells, columns.description),
    ...(currency && { currency }),
    ...(externalId && { externalId }),
    problems,
  };
}

export function isComplete(mapping: Mapping): boolean {
  const { columns, amountLayout } = mapping;
  if (columns.date === null || columns.description === null) return false;
  return amountLayout === 'signed'
    ? columns.amount !== null
    : columns.debit !== null && columns.credit !== null;
}
