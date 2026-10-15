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

const bubble = 'rounded-3xl border-2 bg-card p-5 text-card-foreground';

/** Playful dashboard: chunky rounded bubbles, totals first. */
export function PlayfulDashboard() {
  const t = useTranslations('pages.dashboard');
  const dashboard = useDashboard();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title={t('title')} description={t('description')} />
      <div className={cn(bubble, 'flex flex-col gap-3')}>
        <PeriodControls dashboard={dashboard} />
        <ScopeSwitch dashboard={dashboard} />
      </div>
      <DashboardStatus dashboard={dashboard} />
      <div className={cn('flex flex-col gap-4', dashboard.refreshing && 'opacity-60')}>
        <TotalsTiles dashboard={dashboard} tileClassName={bubble} />
        <UnconvertedList dashboard={dashboard} className={bubble} />
        <CategoryBreakdown dashboard={dashboard} className={bubble} />
        <TrendChart dashboard={dashboard} className={bubble} />
        <BudgetOverview dashboard={dashboard} itemClassName={bubble} />
      </div>
    </div>
  );
}
