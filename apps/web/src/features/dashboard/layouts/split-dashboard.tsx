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

const panel = 'rounded-lg border bg-card p-4 text-card-foreground';

/** Split view dashboard: figures and charts in the main pane, budgets beside them. */
export function SplitDashboard() {
  const t = useTranslations('pages.dashboard');
  const dashboard = useDashboard();
  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader title={t('title')} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodControls dashboard={dashboard} />
        <ScopeSwitch dashboard={dashboard} />
      </div>
      <DashboardStatus dashboard={dashboard} />
      <div
        className={cn(
          'grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start',
          dashboard.refreshing && 'opacity-60',
        )}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <TotalsTiles dashboard={dashboard} tileClassName={panel} />
          <TrendChart dashboard={dashboard} className={panel} />
          <CategoryBreakdown dashboard={dashboard} className={panel} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <UnconvertedList dashboard={dashboard} className={panel} />
          <BudgetOverview dashboard={dashboard} className={panel} />
        </div>
      </div>
    </div>
  );
}
