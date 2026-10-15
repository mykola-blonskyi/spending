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

const tile = 'rounded-2xl border bg-card p-4 text-card-foreground';

/** Bento dashboard: tiles of different sizes on a grid, the trend widest. */
export function BentoDashboard() {
  const t = useTranslations('pages.dashboard');
  const dashboard = useDashboard();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      <PageHeader title={t('title')} className="mb-1" />
      <div className={cn(tile, 'flex flex-wrap items-end justify-between gap-3')}>
        <PeriodControls dashboard={dashboard} />
        <ScopeSwitch dashboard={dashboard} />
      </div>
      <DashboardStatus dashboard={dashboard} />
      <div className={cn('grid gap-3 lg:grid-cols-6', dashboard.refreshing && 'opacity-60')}>
        <TotalsTiles dashboard={dashboard} tileClassName={tile} className="lg:col-span-6" />
        <TrendChart dashboard={dashboard} className={cn(tile, 'lg:col-span-4')} />
        <UnconvertedList dashboard={dashboard} className={cn(tile, 'lg:col-span-2')} />
        <CategoryBreakdown dashboard={dashboard} className={cn(tile, 'lg:col-span-3')} />
        <BudgetOverview dashboard={dashboard} className={cn(tile, 'lg:col-span-3')} />
      </div>
    </div>
  );
}
