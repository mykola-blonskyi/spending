import { useTranslations } from '@i18n/index';
import { PageHeader } from '@shared/components';
import { CompactEntryForm, DeleteButton, EntryStatus } from '../blocks';
import { type EntryForm, useEntryForm } from '../use-entry-form';

/** Split view entry: the whole form at desktop density. */
export function SplitEntryView({ form }: { form: EntryForm }) {
  const t = useTranslations('pages');
  const page = form.mode === 'edit' ? 'editTransaction' : 'addTransaction';
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-6 lg:pt-4">
      <PageHeader title={t(`${page}.title`)} description={t(`${page}.description`)} />
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
