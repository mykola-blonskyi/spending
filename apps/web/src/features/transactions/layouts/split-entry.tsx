import { useTranslations } from '@i18n/index';
import { CompactEntryForm, DeleteButton, EntryStatus } from '../blocks';
import { type EntryForm, useEntryForm } from '../use-entry-form';

/** Split view entry: the whole form at desktop density under a slim pane header. */
export function SplitEntryView({ form }: { form: EntryForm }) {
  const t = useTranslations('pages');
  const page = form.mode === 'edit' ? 'editTransaction' : 'addTransaction';
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-6 lg:pt-4">
      <header className="flex flex-col gap-0.5 border-b pb-3">
        <h1 className="text-[16px] font-semibold tracking-tight lg:text-[15px]">
          {t(`${page}.title`)}
        </h1>
        <p className="text-[13px] text-muted-foreground">{t(`${page}.description`)}</p>
      </header>
      {form.status === 'ready' ? (
        <CompactEntryForm
          form={form}
          footer={form.canDelete && <DeleteButton onConfirm={() => void form.remove()} />}
        />
      ) : (
        <EntryStatus status={form.status} />
      )}
    </section>
  );
}

export function SplitEntry() {
  return <SplitEntryView form={useEntryForm()} />;
}
