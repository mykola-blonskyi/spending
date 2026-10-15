import { useTranslations } from '@i18n/index';
import { formatMoney } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import type { Dashboard } from '../use-dashboard';
import { Section } from './section';

/** Amounts with no EUR rate yet, per currency; they are in no total or chart (BR-15). */
export function UnconvertedList({
  dashboard: { summary },
  className,
}: {
  dashboard: Dashboard;
  className?: string;
}) {
  const t = useTranslations('dashboard.unconverted');
  const { locale } = useSharedLocale();
  if (!summary || summary.unconverted.length === 0) return null;
  return (
    <Section title={t('title')} className={cn('text-sm', className)}>
      <p className="text-xs text-muted-foreground">{t('description')}</p>
      <ul className="flex flex-col gap-1 tabular">
        {summary.unconverted.map((entry) => (
          <li key={entry.currency} className="flex flex-wrap gap-x-3">
            <span className="font-medium">{entry.currency}</span>
            {entry.expenseMinor > 0 && (
              <span>
                {t('spent', { amount: formatMoney(entry.expenseMinor, entry.currency, locale) })}
              </span>
            )}
            {entry.incomeMinor > 0 && (
              <span>
                {t('received', { amount: formatMoney(entry.incomeMinor, entry.currency, locale) })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
