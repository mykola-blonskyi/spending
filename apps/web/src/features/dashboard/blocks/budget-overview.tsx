import { Link } from 'react-router';
import { BudgetProgress } from '@features/budgets';
import { useTranslations } from '@i18n/index';
import { cn } from '@shared/lib/utils';
import { formatMonth } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import type { Dashboard } from '../use-dashboard';
import { Section } from './section';

/** The scope's budgets for the chosen month, or this month for longer periods. */
export function BudgetOverview({
  dashboard: { budgets, budgetMonth },
  className,
  itemClassName,
}: {
  dashboard: Dashboard;
  className?: string;
  itemClassName?: string;
}) {
  const t = useTranslations('dashboard.budgets');
  const { locale } = useSharedLocale();
  if (budgets === undefined) return null;
  return (
    <Section title={t('title', { month: formatMonth(budgetMonth, locale) })} className={className}>
      {budgets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="grid gap-3 @xl/main:grid-cols-2">
          {budgets.map((budget) => (
            <li key={budget.id} className={cn('flex flex-col gap-2', itemClassName)}>
              <BudgetProgress budget={budget} />
            </li>
          ))}
        </ul>
      )}
      <Link
        to="/budgets"
        className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-primary hover:underline"
      >
        {t('manage')}
      </Link>
    </Section>
  );
}
