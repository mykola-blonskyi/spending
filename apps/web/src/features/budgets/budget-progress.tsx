import { CircleAlert, TriangleAlert } from 'lucide-react';
import { useCategoryViews } from '@features/ledger';
import { useTranslations } from '@i18n/index';
import { formatMoney } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { Progress } from '@shared/ui/progress';
import { BUDGET_CURRENCY } from './budget-dialog';
import type { Budget } from './budgets';
import { budgetBar } from './progress';

const INDICATOR: Record<Budget['status'], string> = {
  ok: 'bg-primary',
  near: 'bg-warning',
  over: 'bg-expense',
};

/** A budget's name, status, bar, spent of limit, what is left and its unconverted spending. */
export function BudgetProgress({ budget }: { budget: Budget }) {
  const t = useTranslations();
  const { locale } = useSharedLocale();
  const categories = useCategoryViews().items;
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
    <>
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
    </>
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
