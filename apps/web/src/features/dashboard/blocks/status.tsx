import { QueryUnavailable } from '@data/query-unavailable';
import { useTranslations } from '@i18n/index';
import type { Dashboard } from '../use-dashboard';

/** Loading, offline or failed while there are no figures for the chosen period. */
export function DashboardStatus({ dashboard }: { dashboard: Dashboard }) {
  const t = useTranslations('dashboard');
  if (dashboard.summary || dashboard.problem) return null;
  return (
    <QueryUnavailable
      query={dashboard.summaryQuery}
      offlineTitle={t('offlineTitle')}
      offlineDescription={t('offlineDescription')}
    />
  );
}
