import { ArrowLeft, ChevronRight, Pencil, Tag } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { CategoryView } from '@features/ledger';
import { AuthorBadge } from '@features/family';
import { useTranslations } from '@i18n/index';
import { MoneyText } from '@shared/components';
import { formatDate } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { type EntryRow, fxLabels } from '../history-model';
import { type EntryForm, useEntryForm } from '../use-entry-form';
import { useTransactionDetail } from '../use-transaction-detail';
import { useTransfer } from '../use-transfer';
import {
  AccountSelect,
  AmountInput,
  CategoryPicker,
  CurrencySelect,
  DateField,
  DeleteButton,
  DescriptionField,
  DiscardButton,
  KindToggle,
  NoteField,
  SaveBar,
  ScopeChoice,
} from './entry-fields';
import { ConversionNote, EntryAmount } from './entry-amount';
import { EntryStatus } from './history-status';
import { SyncFailure, SyncMarker } from './sync-marker';
import { TransferButton } from './transfer-action';

/** The category glyph in its color on a muted square (the split view's icon treatment). */
export function CategoryGlyph({
  category,
  className,
}: {
  category: CategoryView | undefined;
  className?: string;
}) {
  const Icon = category?.Icon ?? Tag;
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground',
        className,
      )}
    >
      <Icon
        className="size-[50%]"
        strokeWidth={1.8}
        style={category && { color: category.color }}
      />
    </span>
  );
}

const label = 'text-[13px] font-medium text-muted-foreground';
const select = 'lg:h-9';

/** Every entry field at desktop-form density; shared by the split entry and the detail pane. */
export function CompactEntryForm({ form, footer }: { form: EntryForm; footer?: ReactNode }) {
  return (
    <form
      onSubmit={(event) => void form.submit(event)}
      noValidate
      className="flex flex-col gap-5 text-sm"
    >
      <SyncFailure sync={form.sync} />
      <div className="grid grid-cols-[1fr_7rem] items-end gap-4">
        <AmountInput
          form={form}
          labelClassName={label}
          inputClassName="h-14 rounded-none border-0 border-b bg-transparent px-0 text-4xl tracking-tight shadow-none focus-visible:border-ring focus-visible:ring-0 md:text-4xl dark:bg-transparent"
        />
        <CurrencySelect form={form} labelClassName={label} controlClassName={select} />
      </div>
      <ScopeChoice form={form} />
      <KindToggle
        form={form}
        className="h-11 rounded-md border border-input/50 p-0.5 lg:h-9"
        itemClassName="h-full rounded-[5px] font-medium text-muted-foreground transition-colors duration-150 ease-out hover:bg-transparent hover:text-foreground data-[state=on]:bg-foreground data-[state=on]:text-background"
      />
      <CategoryPicker
        form={form}
        labelClassName={label}
        className="grid-cols-2 gap-1.5 sm:grid-cols-3"
        itemClassName="h-11 flex-row justify-start gap-2 rounded-md px-2.5 text-[13px] font-medium lg:h-9"
        renderCategory={(category) => (
          <>
            <category.Icon
              aria-hidden
              className="size-4 shrink-0"
              strokeWidth={1.8}
              style={{ color: category.color }}
            />
            <span className="truncate">{category.name}</span>
          </>
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <AccountSelect form={form} labelClassName={label} controlClassName={select} />
        <DateField form={form} labelClassName={label} controlClassName="lg:h-9" />
      </div>
      <DescriptionField form={form} labelClassName={label} controlClassName="lg:h-9" />
      <NoteField form={form} labelClassName={label} />
      <SaveBar form={form} buttonClassName="h-11 lg:h-9 lg:text-sm">
        {footer}
      </SaveBar>
    </form>
  );
}

function EditEntry({ id, onSaved }: { id: string; onSaved: () => void }) {
  const form = useEntryForm(id, onSaved);
  return form.status === 'ready' ? (
    <CompactEntryForm form={form} />
  ) : (
    <EntryStatus status={form.status} />
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(6rem,9rem)_1fr] items-baseline gap-4 border-b py-2.5 last:border-b-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Original amount, EUR amount, rate, rate date and source of a non-EUR entry. */
function ConversionMeta({
  conversion,
  amountMinor,
  currency,
}: Pick<EntryRow, 'conversion' | 'amountMinor' | 'currency'>) {
  const t = useTranslations('history');
  const { locale } = useSharedLocale();
  if (conversion.state === 'same') return null;
  const fx =
    conversion.state === 'converted' ? fxLabels(conversion.fx, locale, t('sourceEcb')) : null;
  return (
    <>
      <MetaRow label={t('originalAmount')}>
        <MoneyText amountMinor={amountMinor} currency={currency} />
      </MetaRow>
      <MetaRow label={t('eurAmount')}>
        {conversion.state === 'converted' ? (
          <MoneyText amountMinor={conversion.baseAmountMinor} currency="EUR" />
        ) : conversion.state === 'unavailable' ? (
          <span className="text-muted-foreground">{t('conversionUnavailableHint')}</span>
        ) : (
          <ConversionNote conversion={conversion} className="text-sm" />
        )}
      </MetaRow>
      {fx && (
        <>
          <MetaRow label={t('rate')}>
            <span className="tabular">{fx.rate}</span>
          </MetaRow>
          <MetaRow label={t('rateDate')}>
            <span className="tabular">{fx.date}</span>
          </MetaRow>
          <MetaRow label={t('rateSource')}>{fx.source}</MetaRow>
        </>
      )}
    </>
  );
}

/** Where the other side of a transfer is: an entry on another account, or outside the app. */
function OtherSide({ id }: { id: string }) {
  const t = useTranslations('transfer');
  const { counterpart, outside } = useTransfer(id);
  return (
    <MetaRow label={t('otherSide')}>
      {outside ? (
        t('outside')
      ) : counterpart ? (
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span>{counterpart.accountName ?? counterpart.title}</span>
          <MoneyText
            amountMinor={counterpart.amountMinor}
            currency={counterpart.currency}
            className="text-muted-foreground tabular"
          />
        </span>
      ) : (
        <span className="text-muted-foreground">{t('waiting')}</span>
      )}
    </MetaRow>
  );
}

const iconButton = 'h-11 gap-1.5 px-3 text-[13px] lg:h-8 lg:px-2.5';
const quietButton = cn(
  iconButton,
  'border-transparent bg-transparent shadow-none dark:border-transparent dark:bg-transparent',
);

/**
 * One entry read-only with in-place editing and delete, for master-detail layouts. `onBack`
 * adds a back control for the mobile full-screen view.
 */
export function EntryDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const t = useTranslations();
  const { locale } = useSharedLocale();
  const detail = useTransactionDetail(id);
  const [editing, setEditing] = useState(false);
  const { row } = detail;
  const notSet = <span className="text-muted-foreground">{t('history.detail.notSet')}</span>;

  return (
    <article className="flex min-h-full flex-col">
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b px-2 lg:px-6">
        <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
          {onBack && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('history.detail.back')}
              onClick={onBack}
              className="size-11"
            >
              <ArrowLeft aria-hidden />
            </Button>
          )}
          <span className="max-lg:hidden">{t('pages.transactions.title')}</span>
          {row && (
            <>
              <ChevronRight aria-hidden className="size-3.5 shrink-0 max-lg:hidden" />
              <span className="shrink-0 max-lg:hidden">{row.dateLabel}</span>
              <ChevronRight aria-hidden className="size-3.5 shrink-0 max-lg:hidden" />
              <span
                className={cn('truncate font-medium text-foreground', !editing && 'max-lg:hidden')}
              >
                {row.title}
              </span>
            </>
          )}
        </div>
        {detail.status === 'ready' && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              aria-pressed={editing}
              onClick={() => setEditing((current) => !current)}
              className={cn(iconButton, 'active:scale-[0.97]')}
            >
              <Pencil aria-hidden />
              {editing ? t('history.detail.cancelEdit') : t('history.detail.edit')}
            </Button>
            {row?.sync.state === 'failed' && (
              <DiscardButton onConfirm={() => void detail.discard()} className={quietButton} />
            )}
            <TransferButton id={id} className={quietButton} />
            <DeleteButton
              transfer={Boolean(row?.transfer)}
              onConfirm={() => void detail.remove()}
              className={quietButton}
            />
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-[720px] px-4 py-6 lg:px-8 lg:py-8">
        {detail.status !== 'ready' || !row ? (
          <EntryStatus status={detail.status} />
        ) : editing ? (
          <EditEntry id={id} onSaved={() => setEditing(false)} />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <CategoryGlyph category={row.category} className="size-11 rounded-lg" />
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-tight">
                  <span className="truncate">{row.title}</span>
                  <AuthorBadge entry={row} className="max-w-[45%] text-xs text-muted-foreground" />
                </h2>
                {row.subtitle && (
                  <p className="truncate text-[13px] text-muted-foreground">{row.subtitle}</p>
                )}
                <SyncMarker sync={row.sync} className="flex" />
              </div>
            </div>
            <div className="mt-6">
              <EntryAmount
                row={row}
                align="start"
                colored={false}
                className={cn(
                  'text-4xl font-semibold tracking-tight',
                  row.kind === 'income' && 'text-income',
                )}
                secondaryClassName="text-[13px]"
              />
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t(`transactionForm.${row.kind}`)}
            </p>
            <dl className="mt-8 border-t text-sm">
              <MetaRow label={t('transactionForm.category')}>
                {row.category ? (
                  <span className="flex items-center gap-2">
                    <row.category.Icon
                      aria-hidden
                      className="size-4 shrink-0"
                      strokeWidth={1.8}
                      style={{ color: row.category.color }}
                    />
                    {row.category.name}
                  </span>
                ) : row.transfer ? (
                  t('transfer.label')
                ) : (
                  t('pages.transactions.uncategorized')
                )}
              </MetaRow>
              {row.transfer && <OtherSide id={id} />}
              <MetaRow label={t('transactionForm.account')}>
                {row.accountName ?? t('transactionForm.noAccount')}
              </MetaRow>
              <MetaRow label={t('transactionForm.date')}>
                <span className="tabular">
                  {formatDate(row.occurredOn, locale, { dateStyle: 'long' })}
                </span>
              </MetaRow>
              <ConversionMeta
                conversion={row.conversion}
                amountMinor={row.amountMinor}
                currency={row.currency}
              />
              <MetaRow label={t('transactionForm.description')}>
                {detail.description || notSet}
              </MetaRow>
              <MetaRow label={t('transactionForm.note')}>
                {detail.note ? <span className="whitespace-pre-wrap">{detail.note}</span> : notSet}
              </MetaRow>
            </dl>
          </>
        )}
      </div>
    </article>
  );
}
