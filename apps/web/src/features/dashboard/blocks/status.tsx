import { Link } from 'react-router';
import { QueryUnavailable } from '@data/query-unavailable';
import { useTranslations } from '@i18n/index';
import { type Dashboard, usePeriodLabel } from '../use-dashboard';

const link = 'font-medium text-primary underline-offset-4 hover:underline';

/**
 * Loading, offline or failed while there are no figures for the chosen period; once they arrive,
 * a line with the next steps when the period has nothing in it.
 */
export function DashboardStatus({ dashboard }: { dashboard: Dashboard }) {
  const t = useTranslations('dashboard');
  const periodLabel = usePeriodLabel();
  const { summary } = dashboard;
  if (summary) {
    const empty =
      !dashboard.refreshing &&
      summary.totals.incomeMinor === 0 &&
      summary.totals.expenseMinor === 0 &&
      summary.unconverted.length === 0;
    if (!empty) return null;
    return (
      <p className="text-sm text-muted-foreground">
        {t('emptyPeriod.title', { period: periodLabel(dashboard.period) })}{' '}
        <Link to="/transactions/new" className={link}>
          {t('emptyPeriod.add')}
        </Link>
        {' · '}
        <Link to="/imports/new" className={link}>
          {t('emptyPeriod.import')}
        </Link>
      </p>
    );
  }
  if (dashboard.problem) return null;
  return (
    <QueryUnavailable
      query={dashboard.summaryQuery}
      offlineTitle={t('offlineTitle')}
      offlineDescription={t('offlineDescription')}
    />
  );
}
