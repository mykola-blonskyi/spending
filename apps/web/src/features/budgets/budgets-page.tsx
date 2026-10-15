import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Pencil, PiggyBank, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { QueryUnavailable } from '@data/query-unavailable';
import { useRefetchErrorToast } from '@data/refetch-error-toast';
import { useRefreshOnSync } from '@data/refresh-on-sync';
import { useWorkspaces } from '@data/sync';
import { useProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import { ConfirmDialog, EmptyState, PageHeader } from '@shared/components';
import { formatMonth } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { BudgetDialog } from './budget-dialog';
import { BudgetProgress } from './budget-progress';
import { BUDGETS_KEY, type Budget, budgetsQuery, useDeleteBudget } from './budgets';
import { currentMonth, type Month, shiftMonth } from './month';

export function BudgetsPage() {
  const t = useTranslations();
  const profile = useProfile();
  const thisMonth = currentMonth(profile.timezone);
  const [month, setMonth] = useState<Month>(thisMonth);
  const query = useQuery(budgetsQuery(month));
  const hasFamily = useWorkspaces().items.some((workspace) => workspace.kind === 'family');
  const deleteBudget = useDeleteBudget();
  const [deleting, setDeleting] = useState<Budget | null>(null);
  useRefreshOnSync(BUDGETS_KEY);
  useRefetchErrorToast(query);

  // Another month's rows are no answer for this one: once the switch is paused or fails, they go.
  const stale = query.isPlaceholderData && (query.isError || query.fetchStatus === 'paused');
  const budgets = stale ? undefined : query.data;
  // Being away from this month proves the switcher was there; an error must not remove the way back.
  const canSwitch = month !== thisMonth || (budgets !== undefined && budgets.length > 0);
  const addButton = (
    <Button size="lg">
      <Plus aria-hidden />
      {t('budgets.add')}
    </Button>
  );

  let body: React.ReactNode;
  if (budgets === undefined) {
    body = (
      <QueryUnavailable
        query={query}
        offlineTitle={t('budgets.offlineTitle')}
        offlineDescription={t('budgets.offlineDescription')}
      />
    );
  } else if (budgets.length === 0) {
    body = (
      <EmptyState
        icon={PiggyBank}
        title={t('pages.budgets.emptyTitle')}
        description={t('pages.budgets.emptyDescription')}
        action={<BudgetDialog mode={{ kind: 'create', budgets }} trigger={addButton} />}
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
                  <BudgetRow key={budget.id} budget={budget} onDelete={() => setDeleting(budget)} />
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
            <BudgetDialog mode={{ kind: 'create', budgets }} trigger={addButton} />
          )
        }
      />
      {canSwitch && <MonthSwitcher month={month} thisMonth={thisMonth} onChange={setMonth} />}
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

function BudgetRow({ budget, onDelete }: { budget: Budget; onDelete: () => void }) {
  const t = useTranslations();
  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground sm:p-5">
      <BudgetProgress budget={budget} />
      <div className="-mx-2 mt-auto -mb-2 flex justify-end gap-1">
        <BudgetDialog
          mode={{ kind: 'edit', budget }}
          trigger={
            <Button variant="ghost" size="sm" className="h-10 min-w-10" title={t('budgets.edit')}>
              <Pencil aria-hidden />
              <span className="sr-only sm:not-sr-only">{t('budgets.edit')}</span>
            </Button>
          }
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-10 min-w-10"
          title={t('budgets.delete')}
          onClick={onDelete}
        >
          <Trash2 aria-hidden />
          <span className="sr-only sm:not-sr-only">{t('budgets.delete')}</span>
        </Button>
      </div>
    </li>
  );
}
