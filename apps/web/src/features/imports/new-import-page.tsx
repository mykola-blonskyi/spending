import { Wallet } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { ImportResult } from '@data/imports';
import { type Account, useAccounts, useWorkspaces } from '@data/sync';
import { useTranslations } from '@i18n/index';
import { EmptyState, LoadingState, MoneyText, PageHeader } from '@shared/components';
import { currencyExponent, formatDate } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { FILE_MAX_BYTES, type ParsedStatement, parseStatement, type StatementProblem } from './csv';
import { ImportSummary } from './import-summary';
import { useCreateImport, useHasFamily } from './imports';
import {
  type Columns,
  DATE_FORMATS,
  detectPreset,
  isComplete,
  type Mapping,
  normalizeRow,
  PRESET_IDS,
  type PresetId,
  presetMapping,
} from './mapping';
import { Table, Td, Th, Tr } from './table';

const NONE = 'none';
const PREVIEW_ROWS = 5;
const DELIMITER_NAMES = { ';': 'semicolon', ',': 'comma', '\t': 'tab' } as const;
const COLUMN_FIELDS: readonly (keyof Columns)[] = ['date', 'description', 'externalId', 'currency'];

type FileProblem = StatementProblem | 'TOO_LARGE' | 'UNREADABLE';
type Loaded = { file: File; statement: ParsedStatement; mapping: Mapping };

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
    <div className="flex flex-col gap-1.5">
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
        <SelectValue />
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

function exponentFor(currency: string, fallback: number): number {
  if (!currency) return fallback;
  try {
    return currencyExponent(currency);
  } catch {
    return fallback;
  }
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
  onChange: (mapping: Mapping) => void;
  onSubmit: (rows: ReturnType<typeof normalizeRow>[]) => void;
  submitting: boolean;
}) {
  const t = useTranslations('imports');
  const { locale } = useSharedLocale();
  const base = useId();
  const { statement, mapping } = loaded;
  const { headers, rows } = statement;
  const sample = rows[0]?.cells ?? [];
  const accountExponent = currencyExponent(account.currency);
  const normalized = useMemo(
    () =>
      rows.map((row) =>
        normalizeRow(row, mapping, (currency) => exponentFor(currency, accountExponent)),
      ),
    [rows, mapping, accountExponent],
  );
  const problems = normalized.filter((row) => row.problems.length > 0).length;
  const complete = isComplete(mapping);
  const setColumn = (field: keyof Columns, index: number | null) =>
    onChange({ ...mapping, preset: 'custom', columns: { ...mapping.columns, [field]: index } });
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
        {t('detected', {
          encoding: statement.encoding === 'utf-8' ? 'UTF-8' : 'Windows-1252',
          delimiter: t(`delimiters.${DELIMITER_NAMES[statement.delimiter]}`),
          count: rows.length,
        })}
      </p>

      <div className="flex flex-col gap-1.5">
        <Label id={`${base}-preset`}>{t('bank')}</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          aria-labelledby={`${base}-preset`}
          value={mapping.preset}
          onValueChange={(preset) =>
            PRESET_IDS.includes(preset as PresetId) &&
            onChange(presetMapping(preset as PresetId, headers))
          }
          className="w-full sm:w-auto"
        >
          {PRESET_IDS.map((preset) => (
            <ToggleGroupItem key={preset} value={preset} className="flex-1 px-4 sm:flex-none">
              {t(`presets.${preset}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-2">
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
              onChange({ ...mapping, preset: 'custom', amountLayout: layout })
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
        {COLUMN_FIELDS.filter((f) => f !== 'date' && f !== 'description').map(columnSelect)}
        <Field id={`${base}-dateFormat`} label={t('dateFormat')}>
          <Select
            value={mapping.dateFormat}
            onValueChange={(dateFormat) =>
              onChange({
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
              onChange({ ...mapping, preset: 'custom', decimal })
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
          <h2 className="text-sm font-medium">{t('preview')}</h2>
          <p className="text-xs text-muted-foreground">{t('previewHint')}</p>
        </div>
        <Table>
          <thead>
            <tr>
              <Th className="hidden w-16 sm:table-cell">#</Th>
              <Th>{t('column.date')}</Th>
              <Th>{t('column.description')}</Th>
              <Th className="text-right">{t('column.amount')}</Th>
            </tr>
          </thead>
          <tbody>
            {normalized.slice(0, PREVIEW_ROWS).map((row, index) => {
              const badDate = row.problems.includes('date');
              const badAmount = row.problems.includes('amount');
              const raw = rows[index]!.cells;
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
                        <span className="sr-only"> ({t('unreadable')})</span>
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
              <span>{t('readyRows', { count: rows.length - problems })}</span>
              {problems > 0 && (
                <span className="text-destructive">. {t('problemRows', { count: problems })}</span>
              )}
            </>
          )}
        </p>
      </section>

      <div>
        <Button
          disabled={!complete || submitting || rows.length === 0}
          onClick={() => onSubmit(normalized)}
        >
          {submitting ? t('importing') : t('submit', { count: rows.length })}
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
  const [problem, setProblem] = useState<FileProblem | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

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
        />
      </div>
    );
  }
  if (result) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <ImportSummary
          result={result}
          accountName={account.name}
          waitsForReview={hasFamily}
          onImportAnother={() => {
            setResult(null);
            setLoaded(null);
          }}
        />
      </div>
    );
  }

  const readFile = async (file: File | undefined) => {
    setLoaded(null);
    setProblem(null);
    if (!file) return;
    if (file.size > FILE_MAX_BYTES) return setProblem('TOO_LARGE');
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      return setProblem('UNREADABLE');
    }
    const parsed = parseStatement(bytes);
    if (!parsed.ok) return setProblem(parsed.problem);
    const { statement } = parsed;
    setLoaded({
      file,
      statement,
      mapping: presetMapping(detectPreset(statement.headers), statement.headers),
    });
  };
  const problemText: Record<FileProblem, string> = {
    TOO_LARGE: t('imports.fileTooLarge'),
    TOO_MANY_ROWS: t('imports.tooManyRows'),
    EMPTY: t('imports.emptyFile'),
    UNREADABLE: t('imports.readFailed'),
  };

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
          <Input
            id={fileId}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            aria-invalid={problem !== null || undefined}
            aria-describedby={problem ? `${fileId}-error` : undefined}
            onChange={(event) => void readFile(event.target.files?.[0])}
          />
          {problem && (
            <p id={`${fileId}-error`} role="alert" className="text-sm text-destructive">
              {problemText[problem]}
            </p>
          )}
        </Field>
      </div>
      {loaded && (
        <MappingStep
          loaded={loaded}
          account={account}
          submitting={create.isPending}
          onChange={(mapping) => setLoaded({ ...loaded, mapping })}
          onSubmit={(rows) =>
            create.mutate(
              {
                accountId: account.id,
                fileName: loaded.file.name,
                mapping: {
                  ...loaded.mapping,
                  delimiter: loaded.statement.delimiter,
                  encoding: loaded.statement.encoding,
                },
                rows: rows.map(({ problems: _problems, ...row }) => row),
              },
              { onSuccess: setResult },
            )
          }
        />
      )}
    </div>
  );
}
