import { useTranslations } from '@i18n/index';
import { MoneyText } from '@shared/components';
import { formatMoney, formatPercent } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import type { Dashboard } from '../use-dashboard';
import { Section } from './section';

/**
 * Each kind's categories with a bar for their share and their change since the previous period.
 * Every bar's figures are its text, so the list is its own alternative.
 */
export function CategoryBreakdown({
  dashboard: { summary, categories },
  className,
}: {
  dashboard: Dashboard;
  className?: string;
}) {
  const t = useTranslations('dashboard.categories');
  const { locale } = useSharedLocale();
  if (!summary) return null;
  return (
    <Section title={t('title')} className={className}>
      {categories.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      {(['expense', 'income'] as const).map((kind) => {
        const rows = categories.filter((row) => row.kind === kind);
        if (rows.length === 0) return null;
        return (
          <div key={kind} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t(kind)}</h3>
            <ul className="flex flex-col gap-3">
              {rows.map((row) => (
                <li key={row.key} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{row.name}</span>
                    <MoneyText amountMinor={row.amountMinor} currency="EUR" />
                  </div>
                  <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-muted-foreground"
                      style={{
                        width: `${row.share * 100}%`,
                        ...(row.color && { backgroundColor: row.color }),
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground tabular">
                    <span>{t('share', { share: formatPercent(row.share, locale) })}</span>
                    {row.previousMinor !== null && (
                      <span>
                        {t('change', {
                          amount: formatMoney(row.amountMinor - row.previousMinor, 'EUR', locale, {
                            signDisplay: 'exceptZero',
                          }),
                        })}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </Section>
  );
}
