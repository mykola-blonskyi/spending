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

const entry = 'border-t pt-5';

/** Journal dashboard: sections read top to bottom like pages, divided by rules, no cards. */
export function JournalDashboard() {
  const t = useTranslations('pages.dashboard');
  const dashboard = useDashboard();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} />
      <PeriodControls dashboard={dashboard} />
      <ScopeSwitch dashboard={dashboard} />
      <DashboardStatus dashboard={dashboard} />
      <div className={cn('flex flex-col gap-5', dashboard.refreshing && 'opacity-60')}>
        <TotalsTiles dashboard={dashboard} className={entry} />
        <UnconvertedList dashboard={dashboard} className={entry} />
        <TrendChart dashboard={dashboard} className={entry} />
        <CategoryBreakdown dashboard={dashboard} className={entry} />
        <BudgetOverview dashboard={dashboard} className={entry} itemClassName="border-l-2 pl-3" />
      </div>
    </div>
  );
}
