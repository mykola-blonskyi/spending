import { useTranslations } from '@i18n/index';
import { MoneyText } from '@shared/components';
import { formatDate, formatMoney, formatMonth } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import type { Summary } from '../dashboard-model';
import type { Dashboard } from '../use-dashboard';
import { Section } from './section';

const SLOT = 10;
const BAR = 4;
const HEIGHT = 100;

function useBucketLabel(granularity: Summary['granularity']) {
  const t = useTranslations('dashboard.trend');
  const { locale } = useSharedLocale();
  return (bucket: string) =>
    granularity === 'month'
      ? formatMonth(bucket, locale)
      : granularity === 'week'
        ? t('weekOf', { date: formatDate(bucket, locale) })
        : formatDate(bucket, locale);
}

/** Income and expense bars per bucket, with the same figures as a table. */
export function TrendChart({ dashboard, className }: { dashboard: Dashboard; className?: string }) {
  const t = useTranslations('dashboard');
  const { locale } = useSharedLocale();
  const { summary } = dashboard;
  const bucketLabel = useBucketLabel(summary?.granularity ?? 'day');
  if (!summary) return null;
  const { series } = summary;
  const peak = Math.max(0, ...series.flatMap((b) => [b.incomeMinor, b.expenseMinor]));
  const height = (minor: number) => (peak === 0 ? 0 : (minor / peak) * HEIGHT);

  return (
    <Section title={t('trend.title')} className={className}>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-income" />
          {t('totals.income')}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-expense" />
          {t('totals.expense')}
        </span>
      </div>
      <svg
        role="img"
        aria-label={t('trend.chart', { amount: formatMoney(peak, 'EUR', locale) })}
        viewBox={`0 0 ${series.length * SLOT} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-40 w-full overflow-visible"
      >
        <line
          x1={0}
          x2={series.length * SLOT}
          y1={HEIGHT}
          y2={HEIGHT}
          vectorEffect="non-scaling-stroke"
          className="stroke-border"
        />
        {series.map((bucket, index) => (
          <g key={bucket.bucket}>
            <rect
              x={index * SLOT + 1}
              y={HEIGHT - height(bucket.incomeMinor)}
              width={BAR}
              height={height(bucket.incomeMinor)}
              className="fill-income"
            />
            <rect
              x={index * SLOT + 1 + BAR}
              y={HEIGHT - height(bucket.expenseMinor)}
              width={BAR}
              height={height(bucket.expenseMinor)}
              className="fill-expense"
            />
          </g>
        ))}
      </svg>
      <div aria-hidden className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>{bucketLabel(series[0]?.bucket ?? summary.period.from)}</span>
        <span>{bucketLabel(series.at(-1)?.bucket ?? summary.period.to)}</span>
      </div>
      <details className="text-sm">
        <summary className="w-fit cursor-pointer py-2 text-muted-foreground hover:text-foreground">
          {t('trend.table')}
        </summary>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 font-medium">
                  {t('trend.bucket')}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {t('totals.income')}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {t('totals.expense')}
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((bucket) => (
                <tr key={bucket.bucket} className="border-t">
                  <th scope="row" className="py-1 font-normal">
                    {bucketLabel(bucket.bucket)}
                  </th>
                  <td className="py-1 text-right">
                    <MoneyText amountMinor={bucket.incomeMinor} currency="EUR" />
                  </td>
                  <td className="py-1 text-right">
                    <MoneyText amountMinor={bucket.expenseMinor} currency="EUR" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Section>
  );
}
