import { ChevronDown } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import type { Scope } from '@features/family';
import { useTranslations } from '@i18n/index';
import { PageHeader } from '@shared/components';
import { formatRelativeDay } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import {
  ConversionNote,
  DateField,
  DescriptionField,
  EntryActions,
  EntryStatus,
  NoteField,
  ReceivedInput,
  SyncFailure,
} from '../blocks';
import type { FormKind } from '../form-model';
import { type EntryForm, useEntryForm } from '../use-entry-form';

type Panel = 'date' | 'category' | 'where' | 'account' | 'toAccount' | 'note';

const ring =
  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background';

function Chip({
  open,
  panelId,
  onClick,
  muted,
  children,
}: {
  open: boolean;
  panelId: string;
  onClick: () => void;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={panelId}
      className={cn(
        'inline-flex min-h-11 max-w-full items-center gap-1 rounded-xl px-2.5 align-baseline font-sans text-[0.8em] font-medium tracking-tight transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]',
        open ? 'bg-accent text-accent-foreground' : 'bg-muted text-foreground',
        muted && !open && 'text-muted-foreground',
        ring,
      )}
    >
      <span className="truncate">{children}</span>
      <ChevronDown
        aria-hidden
        className={cn(
          'size-4 shrink-0 opacity-60 transition-transform duration-150',
          open && 'rotate-180',
        )}
        strokeWidth={2}
      />
    </button>
  );
}

function Pills<T extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: T;
  items: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap rounded-3xl border p-0.5">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="radio"
          aria-checked={item.value === value}
          disabled={item.disabled}
          onClick={() => onChange(item.value)}
          className={cn(
            'flex h-10 min-w-11 items-center justify-center rounded-full px-3 text-[13px] transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
            item.value === value
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground',
            ring,
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Options({
  label,
  value,
  items,
  onPick,
}: {
  label: string;
  value: string | null;
  items: readonly { value: string; label: string; icon?: ReactNode }[];
  onPick: (value: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item) => {
        const on = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(item.value)}
            className={cn(
              'flex h-11 items-center gap-2 rounded-full border px-4 text-sm transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]',
              on
                ? 'border-primary bg-accent font-medium text-accent-foreground'
                : 'bg-card hover:bg-muted',
              ring,
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

const PUNCTUATION = /^[,.;:!?]+/;

/**
 * Fills the catalog sentence's `{name}` blanks, so each language orders them its own way. A
 * blank keeps the punctuation after it, so a line never starts with a comma.
 */
function fill(template: string, blanks: Record<string, ReactNode>): ReactNode[] {
  const parts = template.split(/\{(\w+)\}/);
  return parts.map((part, index) => {
    if (index % 2 === 0) return index === 0 ? part : part.replace(PUNCTUATION, '');
    return (
      <span key={part} className="whitespace-nowrap">
        {blanks[part]}
        {PUNCTUATION.exec(parts[index + 1] ?? '')?.[0]}
      </span>
    );
  });
}

function Sentence({
  form,
  open,
  toggle,
  panelIdPrefix,
}: {
  form: EntryForm;
  open: Panel | null;
  toggle: (panel: Panel) => void;
  panelIdPrefix: string;
}) {
  const t = useTranslations();
  const { locale } = useSharedLocale();
  const amountId = useId();
  const { values } = form;
  const invalid = form.errors.amount === 'invalid';
  const { category } = form;
  const transfer = values.kind === 'transfer';
  const account = form.accounts.find((item) => item.id === values.accountId);
  const toAccount =
    values.kind === 'transfer'
      ? form.accounts.find((item) => item.id === values.toAccountId)
      : undefined;
  const chip = (panel: Panel, label: string | undefined, fallback: string) => (
    <Chip
      open={open === panel}
      panelId={`${panelIdPrefix}-${panel}`}
      onClick={() => toggle(panel)}
      muted={!label}
    >
      {label || fallback}
    </Chip>
  );

  return (
    <div>
      <p className="font-serif text-[24px] leading-[1.9] text-foreground/90 lg:text-[28px]">
        {fill(t.raw(`entry.journal.${values.kind}`), {
          date: chip('date', formatRelativeDay(values.occurredOn, locale, form.today), ''),
          amount: (
            <label
              htmlFor={amountId}
              className="tabular inline-flex items-baseline gap-2 rounded-xl bg-muted px-3 py-0.5 align-baseline font-sans text-5xl font-semibold tracking-tight text-foreground focus-within:outline-2 focus-within:outline-ring"
            >
              <input
                id={amountId}
                aria-label={t('transactionForm.amount')}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={values.amount}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${amountId}-error` : undefined}
                onChange={(event) => form.set('amount', event.target.value)}
                className={cn(
                  'min-w-[2ch] bg-transparent [field-sizing:content] outline-none placeholder:text-muted-foreground/60',
                  values.kind === 'income' && 'text-income',
                )}
              />
              <span aria-hidden className="text-3xl text-muted-foreground">
                {values.currency}
              </span>
            </label>
          ),
          category: chip('category', category?.name, t('transactionForm.category')),
          where: chip('where', values.description, t('transactionForm.description')),
          account: chip(
            'account',
            account?.name,
            t(transfer ? 'transactionForm.fromAccount' : 'transactionForm.noAccount'),
          ),
          toAccount: chip('toAccount', toAccount?.name, t('transactionForm.toAccount')),
        })}
      </p>
      {invalid && (
        <p id={`${amountId}-error`} className="mt-2 text-sm text-destructive">
          {t('transactionForm.amountInvalid')}
        </p>
      )}
      {form.errors.accounts && (
        <p className="mt-2 text-sm text-destructive">
          {t(
            form.errors.accounts === 'same'
              ? 'transactionForm.accountsSame'
              : 'transactionForm.accountsRequired',
          )}
        </p>
      )}
      <ReceivedInput form={form} className="mt-4 max-w-xs" />
      <ConversionNote conversion={form.conversion} className="mt-2" />
    </div>
  );
}

/** Journal entry: the form told as one sentence, each blank a chip that opens its options below. */
export function JournalEntry() {
  const form = useEntryForm();
  const t = useTranslations();
  const base = useId();
  const [open, setOpen] = useState<Panel | null>('category');
  const toggle = (panel: Panel) => setOpen((current) => (current === panel ? null : panel));
  const page = form.mode === 'edit' ? 'editTransaction' : 'addTransaction';
  const transferBlocked = form.transferOffered && form.transferBlocked;
  const kinds: readonly { value: FormKind; label: string; disabled?: boolean }[] = [
    { value: 'expense', label: t('transactionForm.expense') },
    { value: 'income', label: t('transactionForm.income') },
    ...(form.transferOffered
      ? [
          {
            value: 'transfer' as const,
            label: t('transactionForm.transfer'),
            disabled: transferBlocked,
          },
        ]
      : []),
  ];
  const { values } = form;
  const scopes: readonly { value: Scope; label: string }[] = [
    { value: 'personal', label: t('family.scope.personal') },
    { value: 'family', label: t('family.scope.family') },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t(`pages.${page}.title`)} />
      {form.status === 'ready' ? (
        <form onSubmit={(event) => void form.submit(event)} noValidate className="flex flex-col">
          <SyncFailure sync={form.sync} className="mb-6" />
          <div className="flex flex-wrap gap-2">
            {form.scopeOffered && (
              <Pills
                label={t('family.scope.label')}
                value={form.scope}
                items={scopes}
                onChange={form.setScope}
              />
            )}
            {!form.isTransfer && (
              <Pills
                label={t('transactionForm.kind')}
                value={values.kind}
                items={kinds}
                onChange={form.setKind}
              />
            )}
            {/* A transfer's currency is its from-account's; an entry's, its account's (BR-39). */}
            {values.kind !== 'transfer' && (
              <Pills
                label={t('transactionForm.currency')}
                value={values.currency}
                items={form.currencies.map((currency) => ({
                  value: currency,
                  label: currency,
                  disabled: values.accountId !== null,
                }))}
                onChange={(currency) => form.set('currency', currency)}
              />
            )}
          </div>
          {values.kind !== 'transfer' && values.accountId !== null && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('transactionForm.accountCurrency')}
            </p>
          )}
          {transferBlocked && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('transactionForm.transferNeedsAccounts')}
            </p>
          )}

          <div className="mt-8">
            <Sentence form={form} open={open} toggle={toggle} panelIdPrefix={base} />
          </div>

          <div className="mt-2 flex">
            <button
              type="button"
              aria-expanded={open === 'note'}
              aria-controls={`${base}-note`}
              onClick={() => toggle('note')}
              className={cn(
                'flex h-11 items-center gap-1 rounded-full text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground',
                ring,
              )}
            >
              <span className="underline decoration-border underline-offset-4">
                {t('transactionForm.note')}
              </span>
              <ChevronDown
                aria-hidden
                className={cn(
                  'size-4 transition-transform duration-150',
                  open === 'note' && 'rotate-180',
                )}
              />
            </button>
          </div>

          {open && (
            <div id={`${base}-${open}`} className="mt-4 border-t pt-4">
              {open === 'category' &&
                (values.kind === 'transfer' ? (
                  <p className="text-sm text-muted-foreground">
                    {t('transactionForm.transferNoCategory')}
                  </p>
                ) : (
                  <Options
                    label={t('transactionForm.category')}
                    value={values.categoryId}
                    items={form.categories.map((category) => ({
                      value: category.id,
                      label: category.name,
                      icon: <category.Icon aria-hidden className="size-4" strokeWidth={1.8} />,
                    }))}
                    onPick={(id) => form.setCategory(id === values.categoryId ? null : id)}
                  />
                ))}
              {open === 'toAccount' && values.kind === 'transfer' && (
                <Options
                  label={t('transactionForm.toAccount')}
                  value={values.toAccountId}
                  items={form.accounts.map((account) => ({
                    value: account.id,
                    label: `${account.name} · ${account.currency}`,
                  }))}
                  onPick={form.setToAccount}
                />
              )}
              {open === 'account' && (
                <Options
                  label={t(
                    values.kind === 'transfer'
                      ? 'transactionForm.fromAccount'
                      : 'transactionForm.account',
                  )}
                  value={values.accountId}
                  items={form.accounts.map((account) => ({
                    value: account.id,
                    label: `${account.name} · ${account.currency}`,
                  }))}
                  onPick={(id) =>
                    form.setAccount(
                      id === values.accountId && values.kind !== 'transfer' ? null : id,
                    )
                  }
                />
              )}
              {open === 'date' && <DateField form={form} />}
              {open === 'where' && <DescriptionField form={form} />}
              {open === 'note' && <NoteField form={form} />}
            </div>
          )}

          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              type="submit"
              disabled={form.submitting}
              className="h-12 rounded-full px-8 text-[15px] transition-transform duration-150 ease-out active:scale-[0.97]"
            >
              {t('transactionForm.save')}
            </Button>
            <EntryActions form={form} className="h-12 rounded-full" />
            <p className="text-center text-xs text-muted-foreground sm:text-left">
              {t('transactionForm.saveHint')}
            </p>
          </div>
        </form>
      ) : (
        <EntryStatus status={form.status} />
      )}
    </div>
  );
}
