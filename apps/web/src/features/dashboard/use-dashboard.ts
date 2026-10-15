import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '@data/client';
import { useRefetchErrorToast } from '@data/refetch-error-toast';
import { useRefreshOnSync } from '@data/refresh-on-sync';
import { present } from '@data/session';
import { useWorkspaces } from '@data/sync';
import { BUDGETS_KEY, budgetsQuery } from '@features/budgets';
import { useCategoryViews } from '@features/ledger';
import { useProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import { formatDate, formatMonth, todayIn } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import {
  compareCategories,
  type DashboardScope,
  type Period,
  type PeriodKind,
  periodContaining,
  periodProblem,
  shiftPeriod,
} from './dashboard-model';

const ANALYTICS_KEY = ['analytics'];

const summaryQuery = (period: Period, scope: DashboardScope) =>
  queryOptions({
    queryKey: [...ANALYTICS_KEY, period.from, period.to, scope],
    queryFn: async ({ signal }) =>
      present(
        (
          await api.GET('/api/v1/analytics/summary', {
            params: { query: { from: period.from, to: period.to, scope, compare: 'previous' } },
            signal,
          })
        ).data,
      ),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

/** The dashboard's period, scope and server figures; every layout's dashboard reads this. */
export function useDashboard() {
  const t = useTranslations('pages.transactions');
  const today = todayIn(useProfile().timezone);
  const [period, setPeriod] = useState<Period>(() => periodContaining('month', today));
  const [chosenScope, setScope] = useState<DashboardScope>('all');
  const scopeOffered = useWorkspaces().items.some((workspace) => workspace.kind === 'family');
  const scope = scopeOffered ? chosenScope : 'all';
  const problem = periodProblem(period);

  const summary = useQuery({ ...summaryQuery(period, scope), enabled: problem === null });
  // Budgets are monthly: the chosen month's, otherwise this month's.
  const budgetMonth = (period.kind === 'month' ? period.from : today).slice(0, 7);
  const budgets = useQuery(budgetsQuery(budgetMonth));
  useRefreshOnSync(ANALYTICS_KEY);
  useRefreshOnSync(BUDGETS_KEY);
  useRefetchErrorToast(summary);

  const views = useCategoryViews().byId;
  // Another period's figures are no answer for this one once the switch is paused or fails.
  const stale = summary.isPlaceholderData && (summary.isError || summary.fetchStatus === 'paused');
  const data = problem === null && !stale ? summary.data : undefined;
  const categories = useMemo(
    () =>
      (data ? compareCategories(data) : []).map((row) => {
        const view = row.categoryId ? views.get(row.categoryId) : undefined;
        return {
          ...row,
          name: view?.name ?? row.name ?? t('uncategorized'),
          color: view?.color ?? row.color,
        };
      }),
    [data, views, t],
  );

  return {
    period,
    problem,
    choosePeriodKind: (kind: PeriodKind) =>
      setPeriod(kind === 'custom' ? { ...period, kind } : periodContaining(kind, period.from)),
    step: (direction: 1 | -1) => setPeriod(shiftPeriod(period, direction)),
    setRange: (range: { from: string; to: string }) => setPeriod({ kind: 'custom', ...range }),
    canStepForward: period.to < today,
    scope,
    setScope,
    scopeOffered,
    summaryQuery: summary,
    summary: data,
    /** The previously chosen period's figures are on screen while this one loads. */
    refreshing: summary.isPlaceholderData,
    categories,
    budgetMonth,
    budgets: budgets.data?.filter((budget) => scope === 'all' || budget.scope === scope),
  };
}

export type Dashboard = ReturnType<typeof useDashboard>;

/** "October 2026", "Q4 2026", "2026" or a date range. */
export function usePeriodLabel() {
  const t = useTranslations();
  const { locale } = useSharedLocale();
  return (period: Pick<Period, 'kind' | 'from' | 'to'>) => {
    if (period.kind === 'month') return formatMonth(period.from, locale);
    if (period.kind === 'year') return period.from.slice(0, 4);
    if (period.kind === 'quarter') {
      return t('dashboard.period.quarterName', {
        quarter: Math.ceil(Number(period.from.slice(5, 7)) / 3),
        year: period.from.slice(0, 4),
      });
    }
    return t('dashboard.period.range', {
      from: formatDate(period.from, locale),
      to: formatDate(period.to, locale),
    });
  };
}
