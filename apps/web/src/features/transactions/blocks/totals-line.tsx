import { useTranslations } from '@i18n/index';
import { MoneyText } from '@shared/components';
import { cn } from '@shared/lib/utils';
import { dayNets, type Totals } from '../history-model';

function Sums({
  expense,
  income,
  currency,
}: {
  expense: number;
  income: number;
  currency: string;
}) {
  const t = useTranslations('pages.transactions');
  return (
    <dl className="flex gap-3">
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
    </dl>
  );
}

/** Spent and received in EUR, then a separate line per currency with no EUR amount (BR-15). */
export function TotalsLine({ totals, className }: { totals: Totals; className?: string }) {
  const t = useTranslations('history');
  const { base, unconverted } = totals;
  const hasBase = base.expense + base.income > 0;
  if (!hasBase && unconverted.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-1 text-sm', className)}>
      {hasBase && <Sums {...base} currency="EUR" />}
      {unconverted.map((sum) => (
        <div key={sum.currency} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-warning" />
            {t('notConverted')}
          </span>
          <Sums {...sum} />
        </div>
      ))}
    </div>
  );
}

/** A day header's net per currency: EUR, then each currency still waiting for a rate. */
export function DayNets({ totals, className }: { totals: Totals; className?: string }) {
  return (
    <span className={cn('flex gap-2', className)}>
      {dayNets(totals).map(({ currency, net }) => (
        <MoneyText key={currency} amountMinor={net} currency={currency} signDisplay="exceptZero" />
      ))}
    </span>
  );
}
