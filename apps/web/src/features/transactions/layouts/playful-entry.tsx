import { ArrowLeftRight, Check, Minus, Plus } from 'lucide-react';
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
  NoteField,
  SaveBar,
  ScopeChoice,
  TransferButton,
} from '../blocks';
import { type EntryForm, useEntryForm } from '../use-entry-form';

const field = 'h-14 rounded-2xl border-input/50 bg-card shadow-none dark:bg-card';

/** Playful entry: sticker kind buttons, a huge amount, a sticker category grid. */
export function PlayfulEntryView({ form }: { form: EntryForm }) {
  const t = useTranslations('pages');
  const page = form.mode === 'edit' ? 'editTransaction' : 'addTransaction';
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <PageHeader
        title={t(`${page}.title`)}
        description={t(`${page}.description`)}
        className="[&_h1]:font-bold"
      />
      {form.status === 'ready' ? (
        <form
          onSubmit={(event) => void form.submit(event)}
          noValidate
          className="flex flex-col gap-6"
        >
          <ScopeChoice form={form} />
          <KindToggle
            form={form}
            className="grid auto-cols-fr grid-flow-col gap-3"
            itemClassName="h-14 rounded-2xl border bg-card text-[15px] font-bold text-muted-foreground transition-[box-shadow,color,transform] duration-150 ease-out hover:bg-card active:scale-[0.97] data-[state=on]:border-transparent data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:ring-[3px] data-[state=on]:ring-primary"
            renderLabel={(kind, label) => (
              <>
                <span
                  aria-hidden
                  className={cn(
                    'flex size-8 items-center justify-center rounded-lg',
                    kind === 'expense' && '-rotate-3 bg-expense/15 text-expense',
                    kind === 'income' && 'rotate-3 bg-income/15 text-income',
                    kind === 'transfer' && 'bg-muted text-muted-foreground',
                  )}
                >
                  {kind === 'expense' && <Minus className="size-4" strokeWidth={2.6} />}
                  {kind === 'income' && <Plus className="size-4" strokeWidth={2.6} />}
                  {kind === 'transfer' && <ArrowLeftRight className="size-4" strokeWidth={2.6} />}
                </span>
                {label}
              </>
            )}
          />

          <div className="flex flex-col items-center gap-2">
            <AmountInput
              form={form}
              className="w-full items-center"
              labelClassName="text-sm text-muted-foreground"
              inputClassName="h-auto border-transparent bg-transparent px-0 text-center text-6xl leading-none font-bold tracking-tight shadow-none md:text-6xl dark:bg-transparent"
            />
            <CurrencySelect
              form={form}
              labelClassName="sr-only"
              className="w-28"
              controlClassName="h-9 justify-center gap-2 rounded-full border-input/50 bg-card font-semibold shadow-none dark:bg-card"
            />
          </div>

          <CategoryPicker
            form={form}
            labelClassName="font-bold"
            className="grid-cols-3 gap-2.5"
            itemClassName="relative h-24 flex-col justify-start gap-2 pt-3 rounded-2xl text-[13px] font-semibold hover:bg-card data-[state=on]:border-transparent data-[state=on]:bg-card data-[state=on]:ring-[3px] data-[state=on]:ring-primary"
            renderCategory={(category) => (
              <>
                <CategoryBadge
                  category={category}
                  className="size-10 rounded-xl group-[:nth-child(odd)]/item:-rotate-3 group-[:nth-child(even)]/item:rotate-3"
                />
                <span className="line-clamp-2 max-w-full px-1 leading-tight break-words hyphens-auto">
                  {category.name}
                </span>
                <span
                  aria-hidden
                  className="absolute -top-2 -right-2 hidden size-6 items-center justify-center rounded-full bg-primary text-primary-foreground ring-[3px] ring-background group-data-[state=on]/item:flex"
                >
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              </>
            )}
          />

          <div className="grid gap-2.5 sm:grid-cols-2">
            <AccountSelect form={form} controlClassName={field} />
            <DateField form={form} controlClassName={field} />
          </div>
          <DescriptionField form={form} controlClassName={field} />
          <NoteField
            form={form}
            controlClassName="rounded-2xl border-input/50 bg-card shadow-none dark:bg-card"
          />

          <SaveBar form={form} buttonClassName="h-14 rounded-2xl text-base font-bold">
            {form.canDiscard && (
              <DiscardButton onConfirm={() => void form.discard()} className="h-12 rounded-2xl" />
            )}
            {form.canDelete && form.entryId && (
              <TransferButton id={form.entryId} className="h-12 rounded-2xl" />
            )}
            {form.canDelete && (
              <DeleteButton
                transfer={form.isTransfer}
                onConfirm={() => void form.remove()}
                className="h-12 rounded-2xl"
              />
            )}
          </SaveBar>
        </form>
      ) : (
        <EntryStatus status={form.status} />
      )}
    </div>
  );
}

export function PlayfulEntry() {
  return <PlayfulEntryView form={useEntryForm()} />;
}
