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

const tile = 'rounded-xl border bg-card p-4 text-card-foreground sm:p-5';

/** Calm minimal dashboard: controls on top, then one bordered card per section. */
export function CalmDashboard() {
  const t = useTranslations('pages.dashboard');
  const dashboard = useDashboard();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('title')} description={t('description')} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodControls dashboard={dashboard} />
        <ScopeSwitch dashboard={dashboard} />
      </div>
      <DashboardStatus dashboard={dashboard} />
      <div className={cn('flex flex-col gap-6', dashboard.refreshing && 'opacity-60')}>
        <TotalsTiles dashboard={dashboard} tileClassName={tile} />
        <UnconvertedList dashboard={dashboard} className={tile} />
        <TrendChart dashboard={dashboard} className={tile} />
        <CategoryBreakdown dashboard={dashboard} className={tile} />
        <BudgetOverview dashboard={dashboard} itemClassName={tile} />
      </div>
    </div>
  );
}
