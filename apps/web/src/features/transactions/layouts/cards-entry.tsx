import { Calendar, ChevronDown, Wallet, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslations } from '@i18n/index';
import { PageHeader } from '@shared/components';
import { cn } from '@shared/lib/utils';
import {
  AccountSelect,
  AmountInput,
  CategoryBadge,
  CategoryPicker,
  CurrencySelect,
  DateField,
  DeleteButton,
  DescriptionField,
  DiscardButton,
  EntryStatus,
  KindToggle,
  Keypad,
  NoteField,
  SaveBar,
  ScopeChoice,
  TransferButton,
} from '../blocks';
import { type EntryForm, HISTORY_PATH, useEntryForm } from '../use-entry-form';

const compactField =
  'h-11 rounded-xl pl-9 text-[13px] font-medium md:text-[13px] dark:bg-transparent';

/** Description, note and currency stay one tap away; open from the start when an edit has them. */
function More({ form }: { form: EntryForm }) {
  const t = useTranslations('nav');
  const [open] = useState(() => Boolean(form.values.description || form.values.note));
  return (
    <details open={open} className="group mt-3">
      <summary className="flex h-11 cursor-pointer list-none items-center gap-1 rounded-xl text-[13px] font-medium text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
        {t('more')}
        <ChevronDown
          aria-hidden
          className="size-4 transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="flex flex-col gap-3 pb-1">
        <CurrencySelect form={form} />
        <DescriptionField form={form} />
        <NoteField form={form} />
      </div>
    </details>
  );
}

/**
 * Card stack entry: a bottom sheet over a muted canvas, the amount typed on a keypad. The canvas
 * bleeds over the cards shell's main padding; another shell passes its own bleed as `className`.
 */
export function CardsEntryView({ form, className }: { form: EntryForm; className?: string }) {
  const t = useTranslations();
  const page = form.mode === 'edit' ? 'editTransaction' : 'addTransaction';
  if (form.status !== 'ready') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t(`pages.${page}.title`)} />
        <EntryStatus status={form.status} />
      </div>
    );
  }
  return (
    <div
      className={cn(
        '-mx-4 -mt-4 -mb-[calc(9rem+env(safe-area-inset-bottom))] bg-muted pt-6',
        className,
      )}
    >
      <div className="mx-auto h-3 w-[88%] rounded-t-3xl bg-card opacity-60" aria-hidden />
      <form
        onSubmit={(event) => void form.submit(event)}
        noValidate
        aria-label={t(`pages.${page}.title`)}
        className="animate-in rounded-t-3xl bg-card px-5 pb-[calc(9rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-16px_var(--foreground)] duration-200 ease-out fade-in slide-in-from-bottom-4 motion-reduce:animate-none"
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-border" aria-hidden />
        <header className="mt-1 mb-2 flex items-center justify-between">
          <h1 className="text-[17px] font-semibold tracking-tight">{t(`pages.${page}.title`)}</h1>
          <Link
            to={HISTORY_PATH}
            aria-label={t('actions.close')}
            className="-mr-2 flex size-11 items-center justify-center rounded-full text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
          >
            <X aria-hidden className="size-5" />
          </Link>
        </header>

        <ScopeChoice form={form} />
        <KindToggle
          form={form}
          className="h-11 rounded-full bg-muted p-1"
          itemClassName="h-9 rounded-full text-[13px] font-semibold text-muted-foreground transition-[background-color,color,box-shadow] duration-150 ease-out hover:bg-transparent data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
        />

        <div className="mt-4 flex flex-col items-center">
          <AmountInput
            form={form}
            inputMode="none"
            className="w-full items-center"
            labelClassName="sr-only"
            inputClassName="h-auto w-auto min-w-[2ch] border-transparent bg-transparent px-2 text-center text-[52px] leading-none font-semibold tracking-tight shadow-none [field-sizing:content] md:text-[52px] dark:bg-transparent"
          />
          <span className="mt-1 text-sm text-muted-foreground">{form.values.currency}</span>
        </div>

        <CategoryPicker
          form={form}
          labelClassName="sr-only"
          className="mt-4 -mx-5 flex w-auto gap-0 overflow-x-auto px-2 [scrollbar-width:none]"
          itemClassName="h-auto w-[88px] shrink-0 gap-1.5 rounded-none border-0 bg-transparent px-0 py-1 text-[11px] text-muted-foreground hover:bg-transparent data-[state=on]:bg-transparent data-[state=on]:font-semibold data-[state=on]:text-foreground"
          renderCategory={(category) => (
            <>
              <CategoryBadge
                category={category}
                className="size-12 transition-colors duration-150 group-data-[state=on]/item:bg-primary! group-data-[state=on]/item:text-primary-foreground!"
              />
              <span className="line-clamp-2 w-full leading-tight break-words hyphens-auto">
                {category.name}
              </span>
            </>
          )}
        />

        <div className="mt-3 grid grid-cols-2 gap-2">
          <AccountSelect
            form={form}
            labelClassName="sr-only"
            controlClassName={compactField}
            icon={<Wallet aria-hidden className="size-4" />}
          />
          <DateField
            form={form}
            labelClassName="sr-only"
            controlClassName={compactField}
            icon={<Calendar aria-hidden className="size-4" />}
          />
        </div>

        <More form={form} />

        <Keypad
          onKey={form.amount.press}
          separator={form.amount.separator}
          className="mt-3 gap-1.5"
          keyClassName="h-14 rounded-2xl bg-transparent text-2xl hover:bg-muted active:bg-muted"
        />

        <SaveBar
          form={form}
          className="mt-4"
          buttonClassName="h-14 rounded-2xl text-[15px] font-semibold"
        >
          {form.canDiscard && <DiscardButton onConfirm={() => void form.discard()} />}
          {form.canDelete && form.entryId && <TransferButton id={form.entryId} />}
          {form.canDelete && (
            <DeleteButton transfer={form.isTransfer} onConfirm={() => void form.remove()} />
          )}
        </SaveBar>
      </form>
    </div>
  );
}

export function CardsEntry() {
  return <CardsEntryView form={useEntryForm()} />;
}
