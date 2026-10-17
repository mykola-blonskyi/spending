import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, Calendar, Wallet } from 'lucide-react';
import { useTranslations } from '@i18n/index';
import { PageHeader } from '@shared/components';
import {
  AccountSelect,
  AmountInput,
  CategoryPicker,
  CurrencySelect,
  DateField,
  DescriptionField,
  EntryActions,
  EntryStatus,
  KindToggle,
  NoteField,
  SaveBar,
  ScopeChoice,
  SyncFailure,
} from '../blocks';
import { useEntryForm } from '../use-entry-form';

const card = 'shadow-[0_1px_2px_color-mix(in_oklch,var(--foreground)_4%,transparent)]';
const label = 'text-[13px] text-muted-foreground';
const field =
  'h-14 rounded-2xl border-transparent bg-card pl-12 text-[15px] font-medium shadow-none md:text-[15px] dark:bg-card';

/** Soft entry: pill kind tabs, a big amount card, pill category chips, two icon fields. */
export function SoftEntry() {
  const form = useEntryForm();
  const t = useTranslations('pages');
  const page = form.mode === 'edit' ? 'editTransaction' : 'addTransaction';
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5">
      <PageHeader title={t(`${page}.title`)} />
      {form.status === 'ready' ? (
        <form
          onSubmit={(event) => void form.submit(event)}
          noValidate
          className="flex flex-col gap-5"
        >
          <SyncFailure sync={form.sync} />
          <ScopeChoice form={form} />
          <KindToggle
            form={form}
            className={`h-14 rounded-full bg-card p-1.5 ${card}`}
            itemClassName="h-full rounded-full text-[15px] font-semibold text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-transparent active:scale-[0.97] data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary"
            renderLabel={(kind, label) => (
              <>
                {kind === 'expense' && <ArrowDownRight aria-hidden className="size-[18px]" />}
                {kind === 'income' && <ArrowUpRight aria-hidden className="size-[18px]" />}
                {kind === 'transfer' && <ArrowLeftRight aria-hidden className="size-[18px]" />}
                {label}
              </>
            )}
          />

          <div
            className={`flex flex-col items-center gap-3 rounded-3xl bg-card px-6 pt-5 pb-6 ${card}`}
          >
            <AmountInput
              form={form}
              className="w-full items-center text-center"
              labelClassName="text-[15px] font-normal text-muted-foreground"
              inputClassName="h-auto border-transparent bg-transparent px-0 text-center text-[64px] leading-none font-semibold tracking-tight shadow-none md:text-[64px] dark:bg-transparent"
            />
            <CurrencySelect
              form={form}
              labelClassName="sr-only"
              className="w-28"
              controlClassName="h-8 justify-center gap-2 rounded-full border-transparent bg-muted text-[13px] shadow-none dark:bg-muted"
            />
          </div>

          <CategoryPicker
            form={form}
            labelClassName={label}
            className="flex flex-wrap gap-2"
            itemClassName="h-12 w-auto flex-row gap-2 rounded-full border-transparent bg-card px-4 pl-3 text-[15px] font-medium hover:bg-card data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            renderCategory={(category) => {
              const Icon = category.Icon;
              return (
                <>
                  <Icon aria-hidden className="size-[18px]" strokeWidth={1.9} />
                  <span className="truncate">{category.name}</span>
                </>
              );
            }}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <AccountSelect
              form={form}
              labelClassName={label}
              controlClassName={field}
              icon={<Wallet aria-hidden className="size-[18px]" />}
            />
            <DateField
              form={form}
              labelClassName={label}
              controlClassName={field}
              icon={<Calendar aria-hidden className="size-[18px]" />}
            />
          </div>
          <DescriptionField
            form={form}
            labelClassName={label}
            controlClassName="h-14 rounded-2xl bg-card border-transparent shadow-none dark:bg-card"
          />
          <NoteField
            form={form}
            labelClassName={label}
            controlClassName="rounded-2xl bg-card border-transparent shadow-none dark:bg-card"
          />

          <SaveBar form={form} buttonClassName="h-14 rounded-full text-[17px] font-semibold">
            <EntryActions form={form} className="h-12 rounded-full" />
          </SaveBar>
        </form>
      ) : (
        <EntryStatus status={form.status} />
      )}
    </div>
  );
}
