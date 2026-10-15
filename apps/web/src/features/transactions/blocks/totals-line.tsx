import { useTranslations } from '@i18n/index';
import { MoneyText } from '@shared/components';
import { cn } from '@shared/lib/utils';
import type { Totals } from '../history-model';

/** Spent and received per currency, never added across currencies. */
export function TotalsLine({ totals, className }: { totals: Totals; className?: string }) {
  const t = useTranslations('pages.transactions');
  if (totals.length === 0) return null;
  return (
    <dl className={cn('flex flex-wrap gap-x-6 gap-y-1 text-sm', className)}>
      {totals.map(({ currency, expense, income }) => (
        <div key={currency} className="flex gap-3">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">{t('totalSpent')}</dt>
            <dd>
              <MoneyText amountMinor={expense} currency={currency} />
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">{t('totalReceived')}</dt>
            <dd>
              <MoneyText amountMinor={income} currency={currency} />
            </dd>
          </div>
        </div>
      ))}
    </dl>
  );
}
