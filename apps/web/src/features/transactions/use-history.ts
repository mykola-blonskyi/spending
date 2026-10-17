import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useAccounts, useInitialSync, useLocalDataStatus, useLocalTransactions } from '@data/sync';
import { useCategoryViews } from '@features/ledger';
import { useProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import { formatDate, formatRelativeDay, todayIn } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import {
  type ActiveFilter,
  activeFilters,
  clearFilter,
  EMPTY_FILTERS,
  groupByDay,
  type HistoryFilters,
  type HistoryKind,
  type RowContext,
  summarize,
  toHistoryRows,
  toQuery,
} from './history-model';

export type HistoryStatus =
  'loading' | 'firstSync' | 'unavailable' | 'empty' | 'noMatches' | 'ready';

/** How rows name their category, account and day. Shared by history and the detail view. */
export function useRowContext(): RowContext {
  const t = useTranslations('pages.transactions');
  const transfer = useTranslations('transfer');
  const { locale } = useSharedLocale();
  const categories = useCategoryViews();
  const accounts = useAccounts();
  const today = todayIn(useProfile().timezone);
  return useMemo(
    () => ({
      categories: categories.byId,
      accounts: new Map(accounts.items.map((account) => [account.id, account])),
      dayLabel: (date: string) => formatRelativeDay(date, locale, today),
      uncategorized: t('uncategorized'),
      transfer: transfer('label'),
      outside: transfer('outside'),
    }),
    [categories.byId, accounts.items, locale, today, t, transfer],
  );
}

/** Everything a history screen shows and does; layouts only arrange it. */
export function useHistory() {
  const t = useTranslations();
  const { locale } = useSharedLocale();
  const { id: selectedId } = useParams();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const text = useDeferredValue(filters.text);
  const { kind, from, to, categoryId, accountId, currency } = filters;
  const categories = useCategoryViews();
  const query = useMemo(() => {
    const base = toQuery({ text, kind, from, to, categoryId, accountId, currency });
    if (!base.text) return base;
    const categoryNames = new Map([...categories.byId].map(([id, c]) => [id, c.name]));
    return { ...base, categoryNames };
  }, [text, kind, from, to, categoryId, accountId, currency, categories.byId]);

  const localStatus = useLocalDataStatus();
  const transactions = useLocalTransactions(query);
  const initialSync = useInitialSync();
  const context = useRowContext();
  const accounts = useAccounts();

  const rows = useMemo(
    () => toHistoryRows(transactions.items, context, !accountId),
    [transactions.items, context, accountId],
  );
  const items = useMemo(() => groupByDay(rows, context.dayLabel), [rows, context.dayLabel]);
  const totals = useMemo(() => summarize(rows), [rows]);

  const status: HistoryStatus =
    localStatus === 'unavailable'
      ? 'unavailable'
      : !transactions.ready
        ? 'loading'
        : rows.length > 0
          ? 'ready'
          : initialSync.active
            ? 'firstSync'
            : Object.keys(query).length > 0
              ? 'noMatches'
              : 'empty';

  const setFilter = useCallback(
    <K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) =>
      setFilters((current) => ({ ...current, [key]: value })),
    [],
  );
  const reset = useCallback(
    () => setFilters((current) => ({ ...EMPTY_FILTERS, text: current.text })),
    [],
  );

  const kindOptions: { value: HistoryKind; label: string }[] = [
    { value: 'all', label: t('pages.transactions.allKinds') },
    { value: 'expense', label: t('transactionForm.expense') },
    { value: 'income', label: t('transactionForm.income') },
  ];

  const chipLabel = (filter: ActiveFilter): string => {
    switch (filter) {
      case 'period': {
        const day = (date: string) => formatDate(date, locale);
        if (from && to) return t('history.periodRange', { from: day(from), to: day(to) });
        return from
          ? t('history.periodFrom', { from: day(from) })
          : t('history.periodTo', { to: day(to) });
      }
      case 'categoryId':
        return categories.byId.get(categoryId)?.name ?? t('transactionForm.category');
      case 'accountId':
        return context.accounts.get(accountId)?.name ?? t('transactionForm.account');
      case 'currency':
        return currency;
    }
  };
  const chips = activeFilters(filters).map((filter) => ({
    key: filter,
    label: chipLabel(filter),
    clear: () => setFilters((current) => clearFilter(current, filter)),
  }));

  const options = useMemo(
    () => ({
      categories: categories.items.filter((category) => kind === 'all' || category.kind === kind),
      accounts: accounts.items,
      currencies: [
        ...new Set([
          ...accounts.items.map((account) => account.currency),
          ...transactions.items.map((entry) => entry.currency),
          ...(currency ? [currency] : []),
        ]),
      ].sort(),
    }),
    [categories.items, accounts.items, transactions.items, kind, currency],
  );

  return {
    filters,
    setFilter,
    reset,
    kindOptions,
    chips,
    options,
    status,
    loaded: initialSync.loaded,
    items,
    totals,
    selectedId,
  };
}

export type History = ReturnType<typeof useHistory>;
