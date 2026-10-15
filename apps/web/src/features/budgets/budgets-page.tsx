import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CloudOff,
  Pencil,
  PiggyBank,
  Plus,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { errorCode } from '@data/api-error';
import { useCategories, useWorkspaces } from '@data/sync';
import { useProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@shared/components';
import { formatMoney, formatMonth } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Progress } from '@shared/ui/progress';
import { BUDGET_CURRENCY, BudgetDialog } from './budget-dialog';
import {
  type Budget,
  budgetsQuery,
  useDeleteBudget,
  useRefetchErrorToast,
  useRefreshBudgetsOnSync,
} from './budgets';
import { currentMonth, type Month, shiftMonth } from './month';
import { budgetBar } from './progress';

const INDICATOR: Record<Budget['status'], string> = {
  ok: 'bg-primary',
  near: 'bg-warning',
  over: 'bg-expense',
};

export function BudgetsPage() {
  const t = useTranslations();
  const profile = useProfile();
  const thisMonth = currentMonth(profile.timezone);
  const [month, setMonth] = useState<Month>(thisMonth);
  const query = useQuery(budgetsQuery(month));
  const hasFamily = useWorkspaces().items.some((workspace) => workspace.kind === 'family');
  const deleteBudget = useDeleteBudget();
  const [deleting, setDeleting] = useState<Budget | null>(null);
  useRefreshBudgetsOnSync();
  useRefetchErrorToast(query);

  // Another month's rows are no answer for this one; a failed refetch keeps this month's list.
  const budgets = query.isError && query.isPlaceholderData ? undefined : query.data;
  const offline =
    budgets === undefined &&
    (query.fetchStatus === 'paused' || (query.isError && errorCode(query.error) === 'NETWORK'));
  const addButton = (
    <Button size="lg">
      <Plus aria-hidden />
      {t('budgets.add')}
    </Button>
  );

  let body: React.ReactNode;
  if (offline) {
    body = (
      <EmptyState
        icon={CloudOff}
        title={t('budgets.offlineTitle')}
        description={t('budgets.offlineDescription')}
      />
    );
  } else if (budgets === undefined && query.isError) {
    body = (
      <ErrorState
        title={t(`errors.${errorCode(query.error)}`)}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (budgets === undefined) {
    body = <LoadingState variant="cards" rows={4} />;
  } else if (budgets.length === 0) {
    body = (
      <EmptyState
        icon={PiggyBank}
        title={t('pages.budgets.emptyTitle')}
        description={t('pages.budgets.emptyDescription')}
        action={<BudgetDialog mode={{ kind: 'create' }} budgets={budgets} trigger={addButton} />}
      />
    );
  } else {
    const groups = hasFamily
      ? (['personal', 'family'] as const).map((scope) => ({
          scope,
          items: budgets.filter((budget) => budget.scope === scope),
        }))
      : [{ scope: null, items: budgets }];
    body = (
      <div
        className={cn(
          'flex flex-col gap-8 transition-opacity duration-200',
          query.isPlaceholderData && 'opacity-60',
        )}
      >
        {groups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <section key={group.scope ?? 'all'} className="flex flex-col gap-3">
              {group.scope && (
                <h2 className="text-sm font-medium text-muted-foreground">
                  {t(`budgets.${group.scope}`)}
                </h2>
              )}
              <ul className="grid gap-3 sm:grid-cols-2">
                {group.items.map((budget) => (
                  <BudgetRow
                    key={budget.id}
                    budget={budget}
                    budgets={budgets}
                    onDelete={() => setDeleting(budget)}
                  />
                ))}
              </ul>
            </section>
          ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t('pages.budgets.title')}
        description={t('pages.budgets.description')}
        actions={
          budgets &&
          budgets.length > 0 && (
            <BudgetDialog mode={{ kind: 'create' }} budgets={budgets} trigger={addButton} />
          )
        }
      />
      {budgets && budgets.length > 0 && (
        <MonthSwitcher month={month} thisMonth={thisMonth} onChange={setMonth} />
      )}
      {body}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('budgets.deleteTitle')}
        description={t('budgets.deleteDescription')}
        confirmLabel={t('budgets.delete')}
        onConfirm={() => {
          if (deleting) deleteBudget.mutate(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function MonthSwitcher({
  month,
  thisMonth,
  onChange,
}: {
  month: Month;
  thisMonth: Month;
  onChange: (month: Month) => void;
}) {
  const t = useTranslations('budgets.month');
  const { locale } = useSharedLocale();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="icon-lg"
        aria-label={t('previous')}
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <h2 aria-live="polite" className="min-w-40 text-center text-lg font-semibold">
        {formatMonth(month, locale)}
      </h2>
      <Button
        variant="outline"
        size="icon-lg"
        aria-label={t('next')}
        disabled={month >= thisMonth}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight aria-hidden />
      </Button>
      {month !== thisMonth && (
        <Button variant="ghost" className="h-10" onClick={() => onChange(thisMonth)}>
          {t('current')}
        </Button>
      )}
    </div>
  );
}

function BudgetRow({
  budget,
  budgets,
  onDelete,
}: {
  budget: Budget;
  budgets: readonly Budget[];
  onDelete: () => void;
}) {
  const t = useTranslations();
  const { locale } = useSharedLocale();
  const categories = useCategories().items;
  const money = (minor: number) => formatMoney(minor, BUDGET_CURRENCY, locale);
  const name =
    categories.find((category) => category.id === budget.categoryId)?.name ??
    t('pages.transactions.uncategorized');
  const bar = budgetBar(budget);
  const progress = t('budgets.progress', {
    spent: money(budget.spentMinor),
    limit: money(budget.amountMinor),
  });

  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="min-w-0 truncate font-medium">{name}</h3>
        <BudgetStatus status={bar.status} overMinor={-bar.remainingMinor} money={money} />
      </div>
      <Progress
        aria-label={name}
        value={bar.percent}
        getValueLabel={() => progress}
        indicatorClassName={INDICATOR[bar.status]}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <p className="tabular">{progress}</p>
        {bar.remainingMinor > 0 && (
          <p className="tabular text-muted-foreground">
            {t('budgets.left', { amount: money(bar.remainingMinor) })}
          </p>
        )}
      </div>
      {budget.unconverted.map((entry) => (
        <p key={entry.currency} className="text-sm text-muted-foreground">
          {t('budgets.unconverted', {
            amount: formatMoney(entry.amountMinor, entry.currency, locale),
          })}
        </p>
      ))}
      <div className="-mx-2 mt-auto -mb-2 flex justify-end gap-1">
        <BudgetDialog
          mode={{ kind: 'edit', budget }}
          budgets={budgets}
          trigger={
            <Button variant="ghost" size="sm" className="h-10 min-w-10">
              <Pencil aria-hidden />
              <span className="sr-only sm:not-sr-only">{t('budgets.edit')}</span>
            </Button>
          }
        />
        <Button variant="ghost" size="sm" className="h-10 min-w-10" onClick={onDelete}>
          <Trash2 aria-hidden />
          <span className="sr-only sm:not-sr-only">{t('budgets.delete')}</span>
        </Button>
      </div>
    </li>
  );
}

function BudgetStatus({
  status,
  overMinor,
  money,
}: {
  status: Budget['status'];
  overMinor: number;
  money: (minor: number) => string;
}) {
  const t = useTranslations('budgets.status');
  if (status === 'ok') {
    return <span className="shrink-0 text-sm text-muted-foreground">{t('ok')}</span>;
  }
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 text-sm font-medium',
        status === 'near' ? 'text-warning-foreground' : 'text-expense',
      )}
    >
      {status === 'near' ? (
        <TriangleAlert aria-hidden className="size-4" />
      ) : (
        <CircleAlert aria-hidden className="size-4" />
      )}
      {status === 'near' ? t('near') : t('over', { amount: money(overMinor) })}
    </span>
  );
}
