import type { LucideIcon } from 'lucide-react';
import { useTranslations } from '@i18n/index';
import { EmptyState, PageHeader } from '@shared/components';
import type { PlaceholderPageKey } from '../destinations';

export function PlaceholderPage({ page, icon }: { page: PlaceholderPageKey; icon: LucideIcon }) {
  const t = useTranslations(`pages.${page}`);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('title')} description={t('description')} />
      <EmptyState icon={icon} title={t('emptyTitle')} description={t('emptyDescription')} />
    </div>
  );
}
