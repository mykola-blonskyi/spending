import { useTranslations } from '@i18n/index';
import { PageHeader } from '@shared/components';
import { CompactEntryForm, EntryActions, EntryStatus } from '../blocks';
import { useEntryForm } from '../use-entry-form';

/** Split view entry: the whole form at desktop density. */
export function SplitEntry() {
  const form = useEntryForm();
  const t = useTranslations('pages');
  const page = form.mode === 'edit' ? 'editTransaction' : 'addTransaction';
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-6 lg:pt-4">
      <PageHeader title={t(`${page}.title`)} description={t(`${page}.description`)} />
      {form.status === 'ready' ? (
        <CompactEntryForm form={form} footer={<EntryActions form={form} />} />
      ) : (
        <EntryStatus status={form.status} />
      )}
    </section>
  );
}
