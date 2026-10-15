import { useTranslations } from '@i18n/index';
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

const card = 'rounded-2xl bg-card p-4 text-card-foreground shadow-sm';

/** Card stack dashboard: a large title, then a rounded card per section. */
export function CardsDashboard() {
  const t = useTranslations('pages.dashboard');
  const dashboard = useDashboard();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="pt-2 text-[32px] leading-none font-bold tracking-tight">{t('title')}</h1>
      <PeriodControls dashboard={dashboard} className={card} />
      <ScopeSwitch dashboard={dashboard} />
      <DashboardStatus dashboard={dashboard} />
      <div className={cn('flex flex-col gap-4', dashboard.refreshing && 'opacity-60')}>
        <TotalsTiles dashboard={dashboard} tileClassName={card} />
        <UnconvertedList dashboard={dashboard} className={card} />
        <TrendChart dashboard={dashboard} className={card} />
        <CategoryBreakdown dashboard={dashboard} className={card} />
        <BudgetOverview dashboard={dashboard} itemClassName={card} />
      </div>
    </div>
  );
}
