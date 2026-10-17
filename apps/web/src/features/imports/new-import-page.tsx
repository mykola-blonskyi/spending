import { Wallet } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ImportResult } from '@data/imports';
import { type Account, useAccounts, useWorkspaces } from '@data/sync';
import { useTranslations } from '@i18n/index';
import { EmptyState, LoadingState, MoneyText, PageHeader } from '@shared/components';
import { formatDate } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { Button, buttonVariants } from '@shared/ui/button';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { ImportSummary } from './import-summary';
import { useCreateImport, useHasFamily } from './imports';
import {
  type Card,
  type Columns,
  DATE_FORMATS,
  detectPreset,
  isComplete,
  listCards,
  type Mapping,
  type NormalizedRow,
  PRESET_IDS,
  type PresetId,
  prepareRows,
  presetMapping,
  recallMapping,
  rememberMapping,
} from './mapping';
import { type ParsedStatement, parseStatement, type StatementFailure } from './statement';
import { Table, Td, Th, Tr } from './table';

const NONE = 'none';
const PREVIEW_ROWS = 5;
const DELIMITER_NAMES = { ';': 'semicolon', ',': 'comma', '\t': 'tab' } as const;
const OPTIONAL_COLUMNS: readonly (keyof Columns)[] = [
  'externalId',
  'currency',
  'card',
  'balance',
  'bankCategory',
  'mcc',
];
const ACCEPT = [
  '.csv',
  '.txt',
  '.xlsx',
  '.xls',
  '.pdf',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/pdf',
].join(',');

/**
 * `card` is the card the user picked, null until they do; `imported` lists the cards of this
 * file already imported, so the next one can follow (BR-36).
 */
type Loaded = {
  file: File;
  statement: ParsedStatement;
  mapping: Mapping;
  card: string | null;
  imported: readonly string[];
};

/** The picked card, else the first not yet imported, preferring the account's currency. */
function cardToImport(cards: readonly Card[], loaded: Loaded, currency: string): Card | undefined {
  const left = cards.filter((c) => !loaded.imported.includes(c.card));
  return (
    cards.find((c) => c.card === loaded.card) ??
    left.find((c) => c.currency.toUpperCase() === currency) ??
    left[0] ??
    cards[0]
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ColumnSelect({
  id,
  value,
  headers,
  sample,
  onChange,
}: {
  id: string;
  value: number | null;
  headers: readonly string[];
  sample: readonly string[];
  onChange: (index: number | null) => void;
}) {
  const t = useTranslations('imports');
  return (
    <Select
      value={value === null ? NONE : String(value)}
      onValueChange={(next) => onChange(next === NONE ? null : Number(next))}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue>
          <span className="truncate">
            {value === null ? t('notMapped') : headers[value] || `#${value + 1}`}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t('notMapped')}</SelectItem>
        {headers.map((header, index) => (
          <SelectItem key={index} value={String(index)}>
            {header || `#${index + 1}`}
            {sample[index] && <span className="text-muted-foreground"> · {sample[index]}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MappingStep({
  loaded,
  account,
  onChange,
  onSubmit,
  submitting,
}: {
  loaded: Loaded;
  account: Account;
  onChange: (loaded: Loaded) => void;
  onSubmit: (rows: NormalizedRow[], card: string | null) => void;
  submitting: boolean;
}) {
  const t = useTranslations('imports');
  const { locale } = useSharedLocale();
  const base = useId();
  const { statement, mapping } = loaded;
  const { headers, rows, format } = statement;
  const sample = rows[0]?.cells ?? [];
  const cards = useMemo(() => listCards(rows, mapping), [rows, mapping]);
  const card = cards.length > 1 ? cardToImport(cards, loaded, account.currency) : undefined;
  const prepared = useMemo(
    () => prepareRows(rows, mapping, account.currency, card?.card ?? null),
    [rows, mapping, account.currency, card?.card],
  );
  const { entries, skipped, balanceMismatches } = prepared;
  const problems = entries.filter(({ normalized }) => normalized.problems.length > 0).length;
  const checks = [
    ...skipped.map((row) => ({ row, note: t('skippedNote') })),
    ...entries
      .filter(({ row }) => balanceMismatches.includes(row.line))
      .map(({ row }) => ({ row, note: t('balanceNote') })),
  ].sort((a, b) => a.row.line - b.row.line);
  const complete = isComplete(mapping);
  const setMapping = (next: Mapping) => onChange({ ...loaded, mapping: next });
  const setColumn = (field: keyof Columns, index: number | null) =>
    setMapping({ ...mapping, preset: 'custom', columns: { ...mapping.columns, [field]: index } });
  const columnSelect = (field: keyof Columns) => (
    <Field key={field} id={`${base}-${field}`} label={t(`column.${field}`)}>
      <ColumnSelect
        id={`${base}-${field}`}
        value={mapping.columns[field]}
        headers={headers}
        sample={sample}
        onChange={(index) => setColumn(field, index)}
      />
    </Field>
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {format.kind === 'csv'
          ? t('detected', {
              encoding: format.encoding === 'utf-8' ? 'UTF-8' : 'Windows-1252',
              delimiter: t(`delimiters.${DELIMITER_NAMES[format.delimiter]}`),
              count: rows.length,
            })
          : t(format.kind === 'xlsx' ? 'detectedWorkbook' : 'detectedPdf', { count: rows.length })}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id={`${base}-preset`} label={t('bank')}>
          <Select
            value={mapping.preset}
            onValueChange={(preset) =>
              PRESET_IDS.includes(preset as PresetId) &&
              setMapping(presetMapping(preset as PresetId, headers))
            }
          >
            <SelectTrigger id={`${base}-preset`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESET_IDS.map((preset) => (
                <SelectItem key={preset} value={preset}>
                  {t(`presets.${preset}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {card && (
          <Field id={`${base}-card`} label={t('card')} hint={t('cardHint')}>
            <Select value={card.card} onValueChange={(next) => onChange({ ...loaded, card: next })}>
              <SelectTrigger id={`${base}-card`} className="w-full">
                <SelectValue>
                  <span className="truncate">{card.card || t('noCard')}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {cards.map((option) => (
                  <SelectItem key={option.card} value={option.card}>
                    {option.card || t('noCard')}
                    <span className="text-muted-foreground">
                      {' '}
                      · {t('cardRows', { currency: option.currency || '—', count: option.count })}
                      {loaded.imported.includes(option.card) && ` · ${t('cardImported')}`}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-medium">{t('columns')}</legend>
        {columnSelect('date')}
        {columnSelect('description')}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label id={`${base}-layout`}>{t('amountLayout')}</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            aria-labelledby={`${base}-layout`}
            value={mapping.amountLayout}
            onValueChange={(layout) =>
              (layout === 'signed' || layout === 'split') &&
              setMapping({ ...mapping, preset: 'custom', amountLayout: layout })
            }
            className="w-full sm:w-auto"
          >
            <ToggleGroupItem value="signed" className="flex-1 px-4 sm:flex-none">
              {t('signed')}
            </ToggleGroupItem>
            <ToggleGroupItem value="split" className="flex-1 px-4 sm:flex-none">
              {t('split')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {mapping.amountLayout === 'signed' ? (
          <div className="sm:col-span-2">{columnSelect('amount')}</div>
        ) : (
          <>
            {columnSelect('debit')}
            {columnSelect('credit')}
          </>
        )}
        {OPTIONAL_COLUMNS.map(columnSelect)}
        <Field id={`${base}-dateFormat`} label={t('dateFormat')}>
          <Select
            value={mapping.dateFormat}
            onValueChange={(dateFormat) =>
              setMapping({
                ...mapping,
                preset: 'custom',
                dateFormat: dateFormat as Mapping['dateFormat'],
              })
            }
          >
            <SelectTrigger id={`${base}-dateFormat`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMATS.map((format) => (
                <SelectItem key={format} value={format}>
                  {t(`dateFormats.${format}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id={`${base}-decimal`} label={t('decimal')}>
          <Select
            value={mapping.decimal}
            onValueChange={(decimal) =>
              (decimal === ',' || decimal === '.') &&
              setMapping({ ...mapping, preset: 'custom', decimal })
            }
          >
            <SelectTrigger id={`${base}-decimal`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=",">{t('decimals.comma')}</SelectItem>
              <SelectItem value=".">{t('decimals.dot')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </fieldset>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5 px-1">
          <h2 id={`${base}-preview`} className="text-sm font-medium">
            {t('preview')}
          </h2>
          <p className="text-xs text-muted-foreground">{t('previewHint')}</p>
        </div>
        <Table aria-labelledby={`${base}-preview`}>
          <thead>
            <tr>
              <Th className="hidden w-16 sm:table-cell">#</Th>
              <Th>{t('column.date')}</Th>
              <Th>{t('column.description')}</Th>
              <Th className="text-right">{t('column.amount')}</Th>
            </tr>
          </thead>
          <tbody>
            {entries.slice(0, PREVIEW_ROWS).map(({ row: source, normalized: row }) => {
              const badDate = row.problems.includes('date');
              const badCurrency = row.problems.includes('currency');
              const badAmount = row.problems.includes('amount') || badCurrency;
              const raw = source.cells;
              return (
                <Tr key={row.line}>
                  <Td className="hidden text-muted-foreground tabular-nums sm:table-cell">
                    {row.line}
                  </Td>
                  <Td className={cn('whitespace-nowrap', badDate && 'text-destructive')}>
                    {badDate ? (
                      <>
                        {row.occurredOn || '—'}
                        <span className="sr-only"> ({t('unreadable')})</span>
                      </>
                    ) : (
                      formatDate(row.occurredOn, locale)
                    )}
                  </Td>
                  <Td className="max-w-xs truncate">{row.description || '—'}</Td>
                  <Td className={cn('text-right', badAmount && 'text-destructive')}>
                    {badAmount ? (
                      <>
                        {(mapping.amountLayout === 'signed'
                          ? raw[mapping.columns.amount ?? -1]
                          : `${raw[mapping.columns.debit ?? -1] ?? ''} / ${raw[mapping.columns.credit ?? -1] ?? ''}`) ||
                          '—'}
                        {badCurrency && ` ${row.currency}`}
                        <span className="sr-only">
                          {' '}
                          ({badCurrency ? t('reasons.INVALID_CURRENCY') : t('unreadable')})
                        </span>
                      </>
                    ) : (
                      <MoneyText
                        amountMinor={row.amountMinor}
                        currency={row.currency ?? account.currency}
                        colored
                      />
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
        <p className="text-sm" role="status">
          {!complete ? (
            <span className="text-muted-foreground">{t('incomplete')}</span>
          ) : (
            <>
              <span>{t('readyRows', { count: entries.length - problems })}</span>
              {problems > 0 && (
                <span className="text-destructive">. {t('problemRows', { count: problems })}</span>
              )}
              {skipped.length > 0 && (
                <span className="text-muted-foreground">
                  . {t('skippedRows', { count: skipped.length })}
                </span>
              )}
              {balanceMismatches.length > 0 && (
                <span className="text-warning-foreground">
                  . {t('balanceRows', { count: balanceMismatches.length })}
                </span>
              )}
            </>
          )}
        </p>
      </section>

      {complete && checks.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5 px-1">
            <h2 id={`${base}-checks`} className="text-sm font-medium">
              {t('checks')}
            </h2>
            <p className="text-xs text-muted-foreground">{t('checksHint')}</p>
          </div>
          <Table aria-labelledby={`${base}-checks`}>
            <thead>
              <tr>
                <Th className="w-16">{t('summary.line')}</Th>
                <Th>{t('column.description')}</Th>
                <Th>{t('note')}</Th>
              </tr>
            </thead>
            <tbody>
              {checks.map(({ row, note }) => (
                <Tr key={row.line}>
                  <Td className="text-muted-foreground tabular-nums">{row.line}</Td>
                  <Td className="max-w-xs truncate">
                    {row.cells[mapping.columns.description ?? -1] || '—'}
                  </Td>
                  <Td className="text-muted-foreground">{note}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      <div>
        <Button
          disabled={!complete || submitting || entries.length === 0}
          onClick={() =>
            onSubmit(
              entries.map(({ normalized }) => normalized),
              card?.card ?? null,
            )
          }
        >
          {submitting ? t('importing') : t('submit', { count: entries.length })}
        </Button>
      </div>
    </div>
  );
}

export function NewImportPage() {
  const t = useTranslations();
  const workspaces = useWorkspaces();
  const accounts = useAccounts();
  const hasFamily = useHasFamily();
  const create = useCreateImport();
  const accountId = useId();
  const fileId = useId();
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<StatementFailure | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const reading = useRef<File | undefined>(undefined);

  const personal = workspaces.items.find((w) => w.kind === 'personal');
  const usable = useMemo(
    () => accounts.items.filter((a) => a.workspaceId === personal?.id && !a.archivedAt),
    [accounts.items, personal?.id],
  );
  const account = usable.find((a) => a.id === selectedAccount) ?? usable[0];

  const header = (
    <PageHeader title={t('imports.newTitle')} description={t('imports.newDescription')} />
  );
  if (!workspaces.ready || !accounts.ready) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <LoadingState rows={3} />
      </div>
    );
  }
  if (!account) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <EmptyState
          icon={Wallet}
          title={t('imports.noAccountsTitle')}
          description={t('imports.noAccountsDescription')}
          action={
            <Button asChild variant="outline">
              <Link to="/accounts">{t('imports.noAccountsAction')}</Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (result) {
    const cards = loaded ? listCards(loaded.statement.rows, loaded.mapping) : [];
    const nextCard = cards.length > 1 && cards.find((c) => !loaded!.imported.includes(c.card));
    return (
      <div className="flex flex-col gap-8">
        {header}
        <ImportSummary
          result={result}
          accountName={account.name}
          waitsForReview={hasFamily}
          nextCard={
            nextCard
              ? {
                  label: nextCard.card || t('imports.noCard'),
                  onClick: () => {
                    setResult(null);
                    setLoaded({ ...loaded!, card: nextCard.card });
                  },
                }
              : undefined
          }
          onImportAnother={() => {
            setResult(null);
            setLoaded(null);
            setFileName(null);
          }}
        />
      </div>
    );
  }

  const readFile = async (file: File | undefined) => {
    setLoaded(null);
    setProblem(null);
    setFileName(file?.name ?? null);
    reading.current = file;
    if (!file) return;
    const parsed = await parseStatement(file);
    // A PDF reads for seconds: a file chosen meanwhile wins.
    if (reading.current !== file) return;
    if (!parsed.ok) return setProblem(parsed);
    const { statement } = parsed;
    const { headers } = statement;
    setLoaded({
      file,
      statement,
      mapping: recallMapping(headers) ?? presetMapping(detectPreset(headers), headers),
      card: null,
      imported: [],
    });
  };
  const problemText = (failure: StatementFailure) =>
    failure.problem === 'TOO_LARGE'
      ? t('imports.fileTooLarge', { size: failure.maxBytes / (1024 * 1024) })
      : {
          TOO_MANY_ROWS: t('imports.tooManyRows'),
          EMPTY: t('imports.emptyFile'),
          UNREADABLE: t('imports.readFailed'),
          LEGACY_XLS: t('imports.legacyXls'),
          PDF_NO_TEXT: t('imports.pdfNoText'),
          PDF_TOO_MANY_PAGES: t('imports.pdfTooManyPages'),
        }[failure.problem];

  return (
    <div className="flex flex-col gap-8">
      {header}
      <div className="grid max-w-xl gap-5">
        <Field id={accountId} label={t('imports.account')} hint={t('imports.accountHint')}>
          <Select value={account.id} onValueChange={setSelectedAccount}>
            <SelectTrigger id={accountId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {usable.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id={fileId} label={t('imports.file')} hint={t('imports.fileHint')}>
          <div className="flex min-w-0 items-center gap-3">
            <input
              id={fileId}
              type="file"
              accept={ACCEPT}
              aria-invalid={problem !== null || undefined}
              aria-describedby={problem ? `${fileId}-error` : undefined}
              onChange={(event) => void readFile(event.target.files?.[0])}
              className="peer sr-only"
            />
            <label
              htmlFor={fileId}
              aria-hidden
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'shrink-0 cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50',
              )}
            >
              {t('imports.chooseFile')}
            </label>
            <span className="min-w-0 truncate text-sm text-muted-foreground">
              {fileName ?? t('imports.noFile')}
            </span>
          </div>
          {problem && (
            <p id={`${fileId}-error`} role="alert" className="text-sm text-destructive">
              {problemText(problem)}
            </p>
          )}
        </Field>
      </div>
      {loaded && (
        <MappingStep
          loaded={loaded}
          account={account}
          submitting={create.isPending}
          onChange={setLoaded}
          onSubmit={(rows, card) => {
            rememberMapping(loaded.statement.headers, loaded.mapping);
            create.mutate(
              {
                accountId: account.id,
                fileName: loaded.file.name,
                // Column choices and format only: card numbers and header metadata stay here.
                mapping: { ...loaded.mapping, ...loaded.statement.format },
                rows: rows.map(({ problems: _problems, ...row }) => row),
              },
              {
                onSuccess: (imported) => {
                  if (card !== null) setLoaded({ ...loaded, imported: [...loaded.imported, card] });
                  setResult(imported);
                },
              },
            );
          }}
        />
      )}
    </div>
  );
}
