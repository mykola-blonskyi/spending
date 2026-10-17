import { useTranslations } from '@i18n/index';
import { MoneyText } from '@shared/components';
import { formatMoney } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { type Dashboard, usePeriodLabel } from '../use-dashboard';
import { Section } from './section';

const TOTALS = [
  { key: 'income', minor: 'incomeMinor' },
  { key: 'expense', minor: 'expenseMinor' },
  { key: 'net', minor: 'balanceMinor' },
] as const;

/** Income, expenses and period net in EUR, each with its change since the previous period. */
export function TotalsTiles({
  dashboard: { summary, period },
  className,
  tileClassName,
}: {
  dashboard: Dashboard;
  className?: string;
  tileClassName?: string;
}) {
  const t = useTranslations('dashboard.totals');
  const { locale } = useSharedLocale();
  const label = usePeriodLabel();
  if (!summary) return null;
  const { previous } = summary;
  return (
    <Section title={t('title')} className={className}>
      <dl className="grid gap-3 @xl/main:grid-cols-3">
        {TOTALS.map(({ key, minor }) => (
          <div key={key} className={cn('flex flex-col gap-1', tileClassName)}>
            <dt className="text-sm text-muted-foreground">{t(key)}</dt>
            <dd className="text-2xl font-semibold">
              <MoneyText
                amountMinor={summary.totals[minor]}
                currency="EUR"
                colored={key === 'net'}
              />
            </dd>
            {previous && (
              <dd className="text-xs text-muted-foreground tabular">
                {t('change', {
                  amount: formatMoney(previous.deltas[minor], 'EUR', locale, {
                    signDisplay: 'exceptZero',
                  }),
                })}
              </dd>
            )}
          </div>
        ))}
      </dl>
      {previous && (
        <p className="text-xs text-muted-foreground">
          {t('comparedWith', {
            // The previous period of a calendar month or year is one too (BR-15).
            period: label({
              ...previous.period,
              kind: period.kind === 'quarter' ? 'custom' : period.kind,
            }),
          })}
        </p>
      )}
    </Section>
  );
}
