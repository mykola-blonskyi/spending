import { useTranslations } from '@i18n/index';
import { PageHeader } from '@shared/components';
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
  SaveBar,
  ScopeChoice,
  SyncFailure,
  TransferButton,
} from '../blocks';
import { type EntryForm, useEntryForm } from '../use-entry-form';

/** Calm minimal entry: kind, a large amount, the category grid, then the details. */
export function CalmEntryView({ form }: { form: EntryForm }) {
  const t = useTranslations('pages');
  const page = form.mode === 'edit' ? 'editTransaction' : 'addTransaction';
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <PageHeader title={t(`${page}.title`)} description={t(`${page}.description`)} />
      {form.status === 'ready' ? (
        <form
          onSubmit={(event) => void form.submit(event)}
          noValidate
          className="flex flex-col gap-6"
        >
          <SyncFailure sync={form.sync} />
          <ScopeChoice form={form} />
          <KindToggle
            form={form}
            className="h-11 rounded-lg bg-muted p-1"
            itemClassName="h-9 rounded-md text-muted-foreground transition-[background-color,color,box-shadow] duration-150 ease-out hover:bg-transparent data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          />
          <div className="flex flex-col items-center gap-3 text-center">
            <AmountInput
              form={form}
              className="w-full items-center"
              inputClassName="h-16 border-transparent bg-transparent text-center text-5xl tracking-tight shadow-none md:text-5xl dark:bg-transparent"
            />
            <CurrencySelect form={form} className="w-32 items-center" />
          </div>
          <CategoryPicker form={form} />
          <div className="grid gap-3 sm:grid-cols-2">
            <AccountSelect form={form} />
            <DateField form={form} />
          </div>
          <DescriptionField form={form} />
          <NoteField form={form} />
          <SaveBar form={form}>
            {form.canDiscard && <DiscardButton onConfirm={() => void form.discard()} />}
            {form.canDelete && form.entryId && <TransferButton id={form.entryId} />}
            {form.canDelete && (
              <DeleteButton transfer={form.isTransfer} onConfirm={() => void form.remove()} />
            )}
          </SaveBar>
        </form>
      ) : (
        <EntryStatus status={form.status} />
      )}
    </div>
  );
}

export function CalmEntry() {
  return <CalmEntryView form={useEntryForm()} />;
}
