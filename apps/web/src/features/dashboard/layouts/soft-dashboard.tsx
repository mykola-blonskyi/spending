import { useTranslations } from '@i18n/index';
import { PageHeader } from '@shared/components';
import { cn } from '@shared/lib/utils';
import {
  BudgetOverview,
  CategoryBreakdown,
  DashboardStatus,
  PeriodControls,
  ScopeSwitch,
  TotalsTiles,
  TrendChart,
  UnconvertedList,
} from '../blocks';
import { useDashboard } from '../use-dashboard';

const surface =
  'rounded-3xl bg-card p-5 text-card-foreground shadow-[0_1px_2px_color-mix(in_oklch,var(--foreground)_4%,transparent)]';

/** Soft dashboard: a narrow column of raised, very round surfaces. */
export function SoftDashboard() {
  const t = useTranslations('pages.dashboard');
  const dashboard = useDashboard();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title={t('title')} description={t('description')} />
      <div className={cn(surface, 'flex flex-col gap-3')}>
        <PeriodControls dashboard={dashboard} />
        <ScopeSwitch dashboard={dashboard} />
      </div>
      <DashboardStatus dashboard={dashboard} />
      <div className={cn('flex flex-col gap-4', dashboard.refreshing && 'opacity-60')}>
        <TotalsTiles dashboard={dashboard} tileClassName={surface} />
        <UnconvertedList dashboard={dashboard} className={surface} />
        <TrendChart dashboard={dashboard} className={surface} />
        <CategoryBreakdown dashboard={dashboard} className={surface} />
        <BudgetOverview dashboard={dashboard} itemClassName={surface} />
      </div>
    </div>
  );
}
