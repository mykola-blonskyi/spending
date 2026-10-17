import { ArrowRight, ClipboardCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ImportResult } from '@data/imports';
import {
  type TransactionEntry,
  useLocalTransactions,
  useSyncStatus,
  useUpdateTransaction,
} from '@data/sync';
import { type CategoryView, useCategoryViews } from '@features/ledger';
import { useTranslations } from '@i18n/index';
import { LoadingState, MoneyText } from '@shared/components';
import { formatDate } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Card } from '@shared/ui/card';
import { Checkbox } from '@shared/ui/checkbox';
import { Label } from '@shared/ui/label';
import { Switch } from '@shared/ui/switch';
import { CategorySelect } from './category-select';
import { learnBankCategories } from './imports';
import { REVIEW_PATH } from './imports-page';
import { Table, Td, Th, Tr } from './table';

/** Checkbox, description, amount; the category sits beside them on wide screens, under them on phones. */
const ROW =
  'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto_14rem]';

const ALL = {};

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card px-4 py-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-pretty text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/**
 * The imported rows, read back from the local store once the pull lands. Changing a category
 * here goes through the sync queue like any edit, which teaches the categorizer the description;
 * the bank category is taught directly while this screen is open (BR-29).
 */
function ImportedEntries({ ids }: { ids: readonly string[] }) {
  const t = useTranslations('imports.summary');
  const tf = useTranslations('transactionForm');
  const { locale } = useSharedLocale();
  const all = useLocalTransactions(ALL);
  const sync = useSyncStatus();
  const categories = useCategoryViews();
  const update = useUpdateTransaction();
  const [uncategorizedOnly, setUncategorizedOnly] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState<string | null>(null);

  const entries = useMemo(() => {
    const wanted = new Set(ids);
    return all.items.filter((entry) => wanted.has(entry.id));
  }, [all.items, ids]);
  const shown = uncategorizedOnly ? entries.filter((e) => e.categoryId === null) : entries;
  const workspaceId = entries[0]?.workspaceId;
  const options = useMemo(
    () => categories.items.filter((c) => c.workspaceId === workspaceId && !c.archived),
    [categories.items, workspaceId],
  );
  const byId = useMemo(() => new Map(options.map((c) => [c.id, c])), [options]);
  const uncategorized = entries.filter((e) => e.categoryId === null).length;
  const allShownSelected = shown.length > 0 && shown.every((e) => selected.has(e.id));

  const saveCategory = (entry: TransactionEntry, categoryId: string | null) =>
    update(entry.id, {
      workspaceId: entry.workspaceId,
      kind: entry.kind,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      occurredOn: entry.occurredOn,
      accountId: entry.accountId,
      categoryId,
      description: entry.description,
      note: entry.note,
      transferId: null,
      transferOutside: false,
    });
  const setCategory = async (entry: TransactionEntry, categoryId: string | null) => {
    await saveCategory(entry, categoryId);
    learnBankCategories([{ transactionId: entry.id, categoryId }]);
  };
  const applyBulk = async () => {
    const category = bulkCategory ? byId.get(bulkCategory) : undefined;
    const changed = [];
    for (const entry of shown) {
      if (!selected.has(entry.id)) continue;
      if (category && category.kind !== entry.kind) continue;
      await saveCategory(entry, category?.id ?? null);
      changed.push({ transactionId: entry.id, categoryId: category?.id ?? null });
    }
    learnBankCategories(changed);
    setSelected(new Set());
  };
  const optionsFor = (entry: TransactionEntry, extra: CategoryView | undefined) =>
    options.filter((c) => c.kind === entry.kind || c.id === extra?.id);

  if (entries.length < ids.length) {
    const stalled = sync?.state === 'offline' || sync?.state === 'authRequired';
    return (
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-sm font-medium text-muted-foreground">{t('entriesTitle')}</h2>
        <LoadingState rows={Math.min(ids.length, 3)} />
        {stalled && (
          <p role="status" className="px-1 text-sm text-muted-foreground">
            {t('pullStalled')}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium text-muted-foreground">{t('entriesTitle')}</h2>
          <p className="text-xs text-muted-foreground">
            {uncategorized === 0 ? t('allCategorized') : t('entriesHint')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="uncategorized-only"
            checked={uncategorizedOnly}
            onCheckedChange={setUncategorizedOnly}
          />
          <Label htmlFor="uncategorized-only" className="text-sm">
            {t('uncategorizedOnly')}
          </Label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 px-4 py-3">
        <span className="text-sm font-medium">{t('selected', { count: selected.size })}</span>
        <CategorySelect
          value={bulkCategory}
          categories={options}
          onChange={setBulkCategory}
          label={t('bulkCategory')}
          noneLabel={t('noCategory')}
          className="min-w-44"
        />
        <Button size="sm" disabled={selected.size === 0} onClick={() => void applyBulk()}>
          {t('apply')}
        </Button>
      </div>

      <div className="rounded-xl border">
        <div className={cn(ROW, 'py-2 text-xs font-medium text-muted-foreground')}>
          <Checkbox
            aria-label={t('selectAll')}
            checked={allShownSelected}
            onCheckedChange={(checked) =>
              setSelected(checked === true ? new Set(shown.map((e) => e.id)) : new Set())
            }
          />
          <span>{tf('description')}</span>
          <span className="justify-self-end">{tf('amount')}</span>
          <span className="hidden sm:block">{tf('category')}</span>
        </div>
        <ul aria-label={t('entriesTitle')} className="divide-y border-t">
          {shown.map((entry) => {
            const current = entry.categoryId ? byId.get(entry.categoryId) : undefined;
            return (
              <li key={entry.id} data-category={current ? 'set' : 'none'} className={ROW}>
                <Checkbox
                  aria-label={t('selectRow', { line: entry.description || entry.occurredOn })}
                  checked={selected.has(entry.id)}
                  onCheckedChange={(checked) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (checked === true) next.add(entry.id);
                      else next.delete(entry.id);
                      return next;
                    })
                  }
                />
                <div className="min-w-0">
                  <span className="block truncate font-medium">{entry.description}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDate(entry.occurredOn, locale)}
                  </span>
                </div>
                <MoneyText
                  amountMinor={entry.kind === 'expense' ? -entry.amountMinor : entry.amountMinor}
                  currency={entry.currency}
                  colored
                  className="justify-self-end"
                />
                <div className="col-span-2 col-start-2 sm:col-span-1 sm:col-start-auto">
                  <CategorySelect
                    value={entry.categoryId}
                    categories={optionsFor(entry, current)}
                    onChange={(categoryId) => void setCategory(entry, categoryId)}
                    label={`${tf('category')}: ${entry.description}`}
                    noneLabel={t('uncategorized')}
                    className={cn(
                      'w-full',
                      !entry.categoryId && 'border-warning text-warning-foreground',
                    )}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export function ImportSummary({
  result,
  accountName,
  waitsForReview,
  nextCard,
  onImportAnother,
}: {
  result: ImportResult;
  accountName: string;
  waitsForReview: boolean;
  /** Another card of the same file still to import (BR-36). */
  nextCard?: { label: string; onClick: () => void };
  onImportAnother: () => void;
}) {
  const t = useTranslations('imports');
  const { batch, imported, duplicates, rejected } = result;
  const heading = useRef<HTMLHeadingElement>(null);
  // The form that was just submitted is gone; move the reader to the result.
  useEffect(() => heading.current?.focus(), []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
          {t('summary.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('summary.description', { fileName: batch.fileName, account: accountName })}
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-3">
        <Stat label={t('summary.imported')} value={imported.count} />
        <Stat
          label={t('summary.duplicates')}
          value={duplicates}
          hint={duplicates > 0 ? t('summary.duplicatesHint') : undefined}
        />
        <Stat label={t('summary.rejected')} value={rejected.length} />
      </dl>

      {rejected.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">
            {t('summary.rejectedTitle')}
          </h2>
          <Table>
            <thead>
              <tr>
                <Th className="w-20">{t('summary.line')}</Th>
                <Th>{t('summary.reason')}</Th>
              </tr>
            </thead>
            <tbody>
              {rejected.map((row) => (
                <Tr key={row.line}>
                  <Td className="tabular-nums">{row.line}</Td>
                  <Td>{t(`reasons.${row.reason}`)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      {imported.count > 0 &&
        (waitsForReview ? (
          <Card className="flex-row items-center gap-4 px-5 py-4">
            <ClipboardCheck aria-hidden className="size-5 shrink-0 text-primary" />
            <p className="flex-1 text-sm text-pretty">
              {t('summary.pendingReview', { count: imported.count })}
            </p>
            <Button asChild size="sm">
              <Link to={REVIEW_PATH}>{t('review.open')}</Link>
            </Button>
          </Card>
        ) : (
          <ImportedEntries ids={imported.transactionIds} />
        ))}

      <div className="flex flex-wrap gap-3">
        {nextCard && (
          <Button onClick={nextCard.onClick}>
            {t('summary.importNextCard', { card: nextCard.label })}
          </Button>
        )}
        <Button variant="outline" onClick={onImportAnother}>
          {t('summary.importAnother')}
        </Button>
        <Button asChild variant="ghost">
          <Link to="/transactions">
            {t('summary.openHistory')}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}
