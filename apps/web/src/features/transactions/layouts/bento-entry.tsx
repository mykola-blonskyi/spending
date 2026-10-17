import type { ReactNode } from 'react';
import { useTranslations } from '@i18n/index';
import { MoneyText, PageHeader } from '@shared/components';
import { currencyExponent, parseAmount } from '@shared/format';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import {
  AccountSelect,
  AmountInput,
  CategoryPicker,
  CurrencySelect,
  DateField,
  DeleteButton,
  DescriptionField,
  DiscardButton,
  EntryStatus,
  KindToggle,
  NoteField,
  ScopeChoice,
  SyncFailure,
  TransferButton,
} from '../blocks';
import { type EntryForm, useEntryForm } from '../use-entry-form';

/** Block labels inside a tile read as the tile's small caps heading. */
const tile =
  'flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 [&_label]:text-[11px] [&_label]:font-semibold [&_label]:tracking-[0.08em] [&_label]:text-muted-foreground [&_label]:uppercase';

function Tile({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn(tile, className)}>{children}</section>;
}

/** Bento entry: one tile per field on a grid, with the save bar summing the entry up. */
export function BentoEntryView({ form }: { form: EntryForm }) {
  const t = useTranslations();
  const page = form.mode === 'edit' ? 'editTransaction' : 'addTransaction';
  const { values } = form;
  const minor = parseAmount(values.amount, currencyExponent(values.currency));
  const { category } = form;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 lg:gap-4">
      <PageHeader title={t(`pages.${page}.title`)} />
      {form.status === 'ready' ? (
        <form
          onSubmit={(event) => void form.submit(event)}
          noValidate
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          <SyncFailure sync={form.sync} className="col-span-2 lg:col-span-4" />
          <Tile className="relative col-span-2 lg:col-span-4">
            <span
              aria-hidden
              className="absolute top-4 right-4 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
            >
              {values.currency}
            </span>
            <AmountInput
              form={form}
              inputClassName="h-auto border-transparent bg-transparent px-0 py-0 text-[3.75rem] leading-none shadow-none focus-visible:ring-0 md:text-[3.75rem] lg:text-[5rem] lg:md:text-[5rem] dark:bg-transparent"
            />
          </Tile>

          <Tile className="col-span-2 lg:col-[1/3] lg:row-[2/5]">
            <CategoryPicker
              form={form}
              className="grid-cols-3"
              itemClassName="border-transparent bg-muted/60 text-xs font-medium hover:bg-muted"
            />
          </Tile>

          <Tile className="col-span-2 lg:col-[3/5] lg:row-[2/3]">
            <ScopeChoice form={form} />
            <KindToggle
              form={form}
              className="h-11 rounded-xl bg-muted p-1"
              itemClassName="h-9 rounded-lg text-muted-foreground transition-[background-color,color,box-shadow] duration-150 ease-out hover:bg-transparent data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            />
            <CurrencySelect form={form} />
          </Tile>
          <Tile className="lg:col-[3/4] lg:row-[3/4]">
            <AccountSelect form={form} />
          </Tile>
          <Tile className="lg:col-[4/5] lg:row-[3/4]">
            <DateField form={form} />
          </Tile>
          <Tile className="col-span-2 lg:col-[3/5] lg:row-[4/5]">
            <DescriptionField form={form} />
            <NoteField form={form} />
          </Tile>

          <Button
            type="submit"
            disabled={form.submitting}
            className="col-span-2 h-14 justify-between rounded-2xl px-5 text-[15px] font-semibold shadow-sm transition-transform duration-150 ease-out active:scale-[0.99] lg:col-span-4 lg:h-16"
          >
            <span>{t('transactionForm.save')}</span>
            <span className="flex items-center gap-1.5 text-sm font-normal opacity-80">
              {minor !== null && (
                <MoneyText
                  amountMinor={values.kind === 'expense' ? -minor : minor}
                  currency={values.currency}
                />
              )}
              {minor !== null && category && <span aria-hidden>·</span>}
              {category && <span>{category.name}</span>}
            </span>
          </Button>
          <div className="col-span-2 flex flex-col items-center gap-3 lg:col-span-4">
            {form.canDiscard && <DiscardButton onConfirm={() => void form.discard()} />}
            {form.canDelete && form.entryId && <TransferButton id={form.entryId} />}
            {form.canDelete && (
              <DeleteButton transfer={form.isTransfer} onConfirm={() => void form.remove()} />
            )}
            <p className="text-center text-xs text-muted-foreground">
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

export function BentoEntry() {
  return <BentoEntryView form={useEntryForm()} />;
}
