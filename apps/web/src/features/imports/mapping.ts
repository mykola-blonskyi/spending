/**
 * From statement columns to the rows `POST /imports` takes. Dates and amounts are parsed
 * exactly; a cell that cannot be read is sent in a form the server rejects with a reason
 * (BR-26), so every rejection is reported in one place with its line number.
 */
import type { ImportRow } from '@data/imports';
import { currencyExponent, MAX_AMOUNT_MINOR } from '@shared/format';
import type { Row } from './statement';

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
  /** Several cards in one file: rows are imported one card at a time (BR-36). */
  card: number | null;
  /** The running balance after each row, checked but never imported. */
  balance: number | null;
  /** The bank's own category text and MCC: category hints only, never stored (BR-29). */
  bankCategory: number | null;
  mcc: number | null;
};
const COLUMN_KEYS = [
  'date',
  'amount',
  'debit',
  'credit',
  'description',
  'externalId',
  'currency',
  'card',
  'balance',
  'bankCategory',
  'mcc',
] as const satisfies readonly (keyof Columns)[];
export type AmountLayout = 'signed' | 'split';

export type Mapping = {
  preset: PresetId;
  columns: Columns;
  amountLayout: AmountLayout;
  dateFormat: DateFormat;
  decimal: DecimalSeparator;
};

export const PRESET_IDS = ['bbva', 'santander', 'monobank', 'privatbank', 'custom'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

type Preset = {
  dateFormat: DateFormat;
  decimal: DecimalSeparator;
  /** Normalized header names, first match wins; an empty list keeps a column unmapped. */
  headers: Partial<Record<keyof Columns, readonly string[]>>;
  /** Header sets only this bank's exports carry; one complete set is enough. */
  signatures: readonly (readonly string[])[];
};

const SPANISH = { dateFormat: 'dmy', decimal: ',' } as const;

const PRESETS: Record<Exclude<PresetId, 'custom'>, Preset> = {
  bbva: {
    ...SPANISH,
    headers: {
      date: ['fecha'],
      description: ['concepto'],
      amount: ['importe'],
      currency: ['divisa'],
      balance: ['disponible'],
    },
    signatures: [['disponible'], ['f.valor']],
  },
  santander: {
    ...SPANISH,
    headers: {
      date: ['fecha operación', 'fecha operacion', 'transaction date', 'fecha'],
      description: ['concepto', 'description'],
      amount: ['importe', 'amount'],
      externalId: ['referencia'],
      balance: ['saldo', 'balance'],
    },
    signatures: [
      ['saldo'],
      ['fecha operación'],
      ['fecha operacion'],
      ['transaction date', 'value date', 'balance'],
    ],
  },
  // The card-currency amount; operation amount, currency, rate, commission and cashback stay out.
  monobank: {
    dateFormat: 'dmy',
    decimal: '.',
    headers: {
      date: ['date and time', 'дата i час операції', 'дата і час операції'],
      description: ['description', 'деталі операції'],
      amount: ['card currency amount', 'сума в валюті картки'],
      currency: [],
      balance: ['balance', 'залишок після операції'],
      mcc: ['mcc'],
    },
    signatures: [
      ['mcc', 'card currency amount'],
      ['mcc', 'сума в валюті картки'],
    ],
  },
  privatbank: {
    dateFormat: 'dmy',
    decimal: '.',
    headers: {
      date: ['дата'],
      description: ['опис операції'],
      amount: ['сума в валюті картки'],
      currency: ['валюта картки'],
      card: ['картка'],
      balance: ['залишок на кінець періоду'],
      bankCategory: ['категорія'],
    },
    signatures: [['картка', 'валюта картки']],
  },
};

const GENERIC: Preset['headers'] = {
  date: ['date', 'fecha', 'дата'],
  description: ['description', 'concepto', 'concept', 'memo', 'опис', 'описание'],
  amount: ['amount', 'importe', 'сумма', 'сума'],
  debit: ['debit', 'cargo', 'débito', 'debito', 'withdrawal'],
  credit: ['credit', 'abono', 'crédito', 'credito', 'deposit'],
  externalId: ['id', 'reference', 'referencia', 'transaction id'],
  currency: ['currency', 'divisa', 'moneda', 'валюта'],
  card: ['card', 'tarjeta', 'картка', 'карта'],
  balance: ['balance', 'saldo', 'залишок', 'остаток'],
  mcc: ['mcc'],
};

/**
 * Composed letters, lowercase, single spaces, and no trailing card currency: "Commission, (UAH)"
 * is "commission". monobank's Ukrainian XLSX writes "ї" as "і" plus a combining diaeresis.
 */
const normalizeHeader = (header: string) =>
  header
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/,? ?\([a-z]{3}\)$/, '');

function matchColumns(headers: readonly string[], names: Preset['headers']): Columns {
  const lower = headers.map(normalizeHeader);
  const find = (candidates: readonly string[] | undefined) => {
    for (const name of candidates ?? []) {
      const index = lower.indexOf(name);
      if (index >= 0) return index;
    }
    return null;
  };
  return Object.fromEntries(COLUMN_KEYS.map((key) => [key, find(names[key])])) as Columns;
}

/** The bank whose signature the header row carries, else `custom`. */
export function detectPreset(headers: readonly string[]): PresetId {
  const lower = new Set(headers.map(normalizeHeader));
  for (const [id, preset] of Object.entries(PRESETS)) {
    if (preset.signatures.some((set) => set.every((name) => lower.has(name)))) {
      return id as PresetId;
    }
  }
  return 'custom';
}

/** A full mapping for the preset; `custom` guesses from common header names. */
export function presetMapping(preset: PresetId, headers: readonly string[]): Mapping {
  const columns =
    preset === 'custom'
      ? matchColumns(headers, GENERIC)
      : matchColumns(headers, { ...GENERIC, ...PRESETS[preset].headers });
  const formats =
    preset === 'custom' ? { dateFormat: 'ymd' as const, decimal: '.' as const } : PRESETS[preset];
  return {
    preset,
    columns,
    amountLayout: columns.amount === null && columns.debit !== null ? 'split' : 'signed',
    dateFormat: formats.dateFormat,
    decimal: formats.decimal,
  };
}

const DATE_PATTERNS: Record<DateFormat, RegExp> = {
  dmy: /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/,
  mdy: /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/,
  ymd: /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/,
};
const TIME = /[\sT]+\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const NAMED_MONTH = /^(\d{1,2}) ([^\d\s.]+)\.? (\d{4})$/;
/** English and Spanish month names; a name is read from any prefix of three or more letters. */
const MONTHS = [
  ['january', 'enero'],
  ['february', 'febrero'],
  ['march', 'marzo'],
  ['april', 'abril'],
  ['may', 'mayo'],
  ['june', 'junio'],
  ['july', 'julio'],
  ['august', 'agosto'],
  ['september', 'septiembre'],
  ['october', 'octubre'],
  ['november', 'noviembre'],
  ['december', 'diciembre'],
];

/** The server's calendarDateSchema range; a year outside it is rejected there anyway. */
const YEAR_MIN = 1970;
const YEAR_MAX = 2100;

/** [year, month, day] as written, before checking it is a real date. */
function dateParts(text: string, format: DateFormat): [number, number, number] | null {
  const named = NAMED_MONTH.exec(text);
  if (named) {
    const name = named[2]!.toLowerCase();
    const month = MONTHS.findIndex((names) =>
      names.some((full) => name.length >= 3 && full.startsWith(name)),
    );
    return month < 0 ? null : [Number(named[3]), month + 1, Number(named[1])];
  }
  // A four-digit year first is unambiguous; XLSX date cells come out this way.
  const match = (DATE_PATTERNS.ymd.exec(text) ?? DATE_PATTERNS[format].exec(text))?.slice(1);
  if (!match) return null;
  const parts = match.map(Number) as [number, number, number];
  if (match[0]!.length === 4) return parts;
  return format === 'dmy' ? [parts[2], parts[1], parts[0]] : [parts[2], parts[0], parts[1]];
}

/**
 * `YYYY-MM-DD` for a real calendar date in the format and the server's range, else null. A time
 * after the date is dropped and the printed day kept, with no time zone shift.
 */
export function parseDate(text: string, format: DateFormat): string | null {
  const parts = dateParts(text.trim().replace(TIME, '').replace(/\s+/g, ' '), format);
  if (!parts) return null;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < YEAR_MIN ||
    year > YEAR_MAX ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

const KNOWN_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

/** How local statements write a currency besides its code and symbol (uppercase, as compared). */
const LOCAL_MARKERS: Record<string, string[]> = { UAH: ['ГРН', 'ГРН.'] };

const markers = new Map<string, string[]>();
/** "EUR", "€": what may stand before or after an amount in this currency. */
function currencyMarkers(currency: string): string[] {
  let found = markers.get(currency);
  if (!found) {
    const symbol = (display: 'symbol' | 'narrowSymbol') =>
      new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: display })
        .formatToParts(1)
        .find((part) => part.type === 'currency')!.value;
    found = [
      ...new Set([
        currency,
        symbol('symbol'),
        symbol('narrowSymbol'),
        ...(LOCAL_MARKERS[currency] ?? []),
      ]),
    ];
    markers.set(currency, found);
  }
  return found;
}

/** The amount without its currency's code or symbol, which may follow a leading sign. */
function withoutCurrency(text: string, currency: string): string {
  const [, sign = '', rest = ''] = /^([+\-−]?)\s*(.*)$/s.exec(text.trim())!;
  const upper = rest.toUpperCase();
  for (const marker of KNOWN_CURRENCIES.has(currency) ? currencyMarkers(currency) : []) {
    if (upper.startsWith(marker)) return sign + rest.slice(marker.length).trim();
    if (upper.endsWith(marker)) return sign + rest.slice(0, -marker.length).trim();
  }
  return sign + rest;
}

/**
 * The only money parser on the import path: the server validates `amountMinor` alone.
 * "1.234,56", "-12.5", "1 234.5", "-9,99€" to signed minor units. Grouping characters are
 * accepted only between groups of three digits, so a wrong separator choice fails ("12,50" with
 * "." as decimal) instead of scaling the amount. A code or symbol of `currency` may stand before
 * or after the number; any other currency is not an amount. Extra decimals must be zeros ("1500.0"
 * in yen), but three of them read as a thousands group and fail. A leading U+2212 minus is read
 * as "-"; parentheses or a trailing minus are not amounts. Null for anything else.
 */
export function parseAmountToMinor(
  text: string,
  exponent: number,
  decimalSeparator: DecimalSeparator,
  currency: string,
): number | null {
  const groupChars = decimalSeparator === ',' ? ". \\u00a0\\u202f'" : ", \\u00a0\\u202f'";
  const match = new RegExp(
    `^([+-]?)(\\d{1,3}(?:([${groupChars}])\\d{3}(?:\\3\\d{3})*)?|\\d+)(?:\\${decimalSeparator}(\\d+))?$`,
  ).exec(withoutCurrency(text, currency).replace(/^−/, '-'));
  if (!match) return null;
  const integer = match[2]!.replace(/\D/g, '');
  let fraction = match[4] ?? '';
  if (
    fraction.length > exponent &&
    fraction.length !== 3 &&
    /^0*$/.test(fraction.slice(exponent))
  ) {
    fraction = fraction.slice(0, exponent);
  }
  if (fraction.length > exponent) return null;
  const minor = BigInt(integer + fraction.padEnd(exponent, '0'));
  if (minor > BigInt(MAX_AMOUNT_MINOR)) return null;
  return Number(match[1] === '-' ? -minor : minor);
}

const MCC = /^\d{4}$/;
const BANK_CATEGORY_MAX = 100;

export type NormalizedRow = ImportRow & {
  /** Which cells could not be read; the server will reject the row for the same reason. */
  problems: ('date' | 'amount' | 'currency')[];
};

/** A dash is how banks print an empty cell. */
const cellAt = (cells: readonly string[], index: number | null) => {
  const cell = index === null ? '' : (cells[index] ?? '');
  return cell === '—' ? '' : cell;
};

/** Digits of a currency cell ('' is the account's), or null for a code the server would refuse. */
export function exponentFor(currency: string, fallback: number): number | null {
  if (!currency) return fallback;
  return /^[A-Z]{3}$/.test(currency) && KNOWN_CURRENCIES.has(currency)
    ? currencyExponent(currency)
    : null;
}

/** The row's currency cell ('' when unmapped or empty) and the money reader for that currency. */
function rowMoney(cells: readonly string[], mapping: Mapping, accountCurrency: string) {
  const currency = cellAt(cells, mapping.columns.currency).trim().toUpperCase();
  const exponent = exponentFor(currency, currencyExponent(accountCurrency));
  // An unknown currency is rejected anyway; the account's digits still show the amount.
  const digits = exponent ?? currencyExponent(accountCurrency);
  const read = (text: string) =>
    parseAmountToMinor(text, digits, mapping.decimal, currency || accountCurrency);
  return { currency, known: exponent !== null, read };
}

/** Debit and credit columns hold unsigned amounts: money out is negative. */
function readAmount(
  cells: readonly string[],
  mapping: Mapping,
  read: (text: string) => number | null,
): number | null {
  const { columns } = mapping;
  if (mapping.amountLayout === 'signed') return read(cellAt(cells, columns.amount));
  const debit = cellAt(cells, columns.debit);
  const credit = cellAt(cells, columns.credit);
  const credited = credit === '' ? 0 : read(credit);
  const debited = debit === '' ? 0 : read(debit);
  if (credited === null || debited === null) return null;
  return Math.abs(credited) - Math.abs(debited);
}

/** `accountCurrency` is used for rows whose currency cell is unmapped or empty. */
export function normalizeRow(
  row: { line: number; cells: readonly string[] },
  mapping: Mapping,
  accountCurrency: string,
): NormalizedRow {
  const { columns } = mapping;
  const problems: NormalizedRow['problems'] = [];
  const rawDate = cellAt(row.cells, columns.date);
  const occurredOn = parseDate(rawDate, mapping.dateFormat);
  if (occurredOn === null) problems.push('date');
  const { currency, known, read } = rowMoney(row.cells, mapping, accountCurrency);
  if (!known) problems.push('currency');
  const amountMinor = readAmount(row.cells, mapping, read);
  if (amountMinor === null || amountMinor === 0) problems.push('amount');
  const externalId = cellAt(row.cells, columns.externalId);
  const bankCategory = cellAt(row.cells, columns.bankCategory).trim().slice(0, BANK_CATEGORY_MAX);
  const mcc = cellAt(row.cells, columns.mcc).trim();
  return {
    line: row.line,
    occurredOn: occurredOn ?? rawDate,
    amountMinor: amountMinor ?? 0,
    description: cellAt(row.cells, columns.description),
    ...(currency && { currency }),
    ...(externalId && { externalId }),
    ...(bankCategory && { bankCategory }),
    ...(MCC.test(mcc) && { mcc }),
    problems,
  };
}

export type Card = { card: string; currency: string; count: number };

/** The cards in the card column, in file order, each with the currency of its first row. */
export function listCards(rows: readonly Row[], mapping: Mapping): Card[] {
  if (mapping.columns.card === null) return [];
  const cards = new Map<string, Card>();
  for (const { cells } of rows) {
    const card = cellAt(cells, mapping.columns.card);
    const found = cards.get(card);
    if (found) found.count += 1;
    else cards.set(card, { card, currency: cellAt(cells, mapping.columns.currency), count: 1 });
  }
  return [...cards.values()];
}

type Balanced = { line: number; amountMinor: number; balanceMinor: number | null };

/**
 * Lines whose balance is not the previous balance plus their amount (BR-36). Banks list rows
 * newest or oldest first; the direction more pairs agree with is the file's. Pairs missing a
 * balance are not checked.
 */
export function balanceMismatches(rows: readonly Balanced[]): number[] {
  const pairs = rows.slice(1).map((row, i) => [rows[i]!, row] as const);
  const follows = (earlier: Balanced, later: Balanced) =>
    earlier.balanceMinor === null ||
    later.balanceMinor === null ||
    earlier.balanceMinor + later.amountMinor === later.balanceMinor;
  const oldestFirst = pairs.filter(([a, b]) => follows(a, b)).length;
  const newestFirst = pairs.filter(([a, b]) => follows(b, a)).length;
  return newestFirst > oldestFirst
    ? pairs.filter(([a, b]) => !follows(b, a)).map(([a]) => a.line)
    : pairs.filter(([a, b]) => !follows(a, b)).map(([, b]) => b.line);
}

export type PreparedRows = {
  /** Rows to send, with the cells they came from. */
  entries: { row: Row; normalized: NormalizedRow }[];
  /** Rows with no amount in the account currency: listed, never sent (BR-36). */
  skipped: Row[];
  balanceMismatches: number[];
};

/** The statement as it will be imported: one card's rows (all when `card` is null), checked. */
export function prepareRows(
  rows: readonly Row[],
  mapping: Mapping,
  accountCurrency: string,
  card: string | null,
): PreparedRows {
  const { columns } = mapping;
  const picked =
    columns.card === null || card === null
      ? rows
      : rows.filter((row) => cellAt(row.cells, columns.card) === card);
  const amountCells =
    mapping.amountLayout === 'signed' ? [columns.amount] : [columns.debit, columns.credit];
  const entries: PreparedRows['entries'] = [];
  const skipped: Row[] = [];
  for (const row of picked) {
    if (amountCells.every((index) => cellAt(row.cells, index) === '')) skipped.push(row);
    else entries.push({ row, normalized: normalizeRow(row, mapping, accountCurrency) });
  }
  const chain =
    columns.balance === null
      ? []
      : entries
          .filter(({ normalized }) => !normalized.problems.includes('amount'))
          .map(({ row, normalized }) => ({
            line: row.line,
            amountMinor: normalized.amountMinor,
            balanceMinor: rowMoney(row.cells, mapping, accountCurrency).read(
              cellAt(row.cells, columns.balance),
            ),
          }));
  return { entries, skipped, balanceMismatches: balanceMismatches(chain) };
}

const STORAGE_PREFIX = 'spending.importMapping:';
const storageKey = (headers: readonly string[]) =>
  STORAGE_PREFIX + headers.map(normalizeHeader).join('\u001f');

function isMapping(value: unknown, width: number): value is Mapping {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Partial<Mapping>;
  const column = (index: unknown) =>
    index === null ||
    (Number.isInteger(index) && (index as number) >= 0 && (index as number) < width);
  return (
    PRESET_IDS.includes(m.preset as PresetId) &&
    (m.amountLayout === 'signed' || m.amountLayout === 'split') &&
    DATE_FORMATS.includes(m.dateFormat as DateFormat) &&
    (m.decimal === '.' || m.decimal === ',') &&
    typeof m.columns === 'object' &&
    m.columns !== null &&
    COLUMN_KEYS.every((key) => column(m.columns![key]))
  );
}

/** The mapping last imported with this header row on this device, if any (BR-36). */
export function recallMapping(headers: readonly string[]): Mapping | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(headers)) ?? 'null');
    return isMapping(value, headers.length) ? value : null;
  } catch {
    return null;
  }
}

export function rememberMapping(headers: readonly string[], mapping: Mapping): void {
  try {
    localStorage.setItem(storageKey(headers), JSON.stringify(mapping));
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the preset still applies.
  }
}

export function isComplete(mapping: Mapping): boolean {
  const { columns, amountLayout } = mapping;
  if (columns.date === null || columns.description === null) return false;
  return amountLayout === 'signed'
    ? columns.amount !== null
    : columns.debit !== null && columns.credit !== null;
}
