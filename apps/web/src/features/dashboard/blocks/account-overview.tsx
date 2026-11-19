import { useAccountPeriods, useAccounts, useWorkspaces } from '@data/sync';
import { useTranslations } from '@i18n/index';
import { MoneyText } from '@shared/components';
import { formatMoney } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import type { Dashboard } from '../use-dashboard';
import { Section } from './section';

const FLOWS = [
  { key: 'income', minor: 'incomeMinor', sign: 1 },
  { key: 'expense', minor: 'expenseMinor', sign: -1 },
  { key: 'transfersIn', minor: 'transfersInMinor', sign: 1 },
  { key: 'transfersOut', minor: 'transfersOutMinor', sign: -1 },
] as const;

/**
 * Each active account of the scope: its balance at the end of the period and what moved in and
 * out of it, transfers apart, in the account's own currency. Read from this device's entries.
 */
export function AccountOverview({
  dashboard: { period, scope },
  className,
  tileClassName,
}: {
  dashboard: Dashboard;
  className?: string;
  tileClassName?: string;
}) {
  const t = useTranslations('dashboard.accounts');
  const { locale } = useSharedLocale();
  const periods = useAccountPeriods(period);
  const kinds = new Map(useWorkspaces().items.map((w) => [w.id, w.kind]));
  const accounts = useAccounts().items.filter(
    (a) => a.archivedAt === null && (scope === 'all' || kinds.get(a.workspaceId) === scope),
  );
  if (accounts.length === 0) return null;
  return (
    <Section title={t('title')} className={className}>
      <ul className="grid gap-3 @xl/main:grid-cols-2">
        {accounts.map((account) => {
          const flows = periods.get(account.id);
          return (
            <li key={account.id} className={cn('flex flex-col gap-1', tileClassName)}>
              <span className="text-sm text-muted-foreground">{account.name}</span>
              <MoneyText
                amountMinor={flows?.closingMinor ?? 0}
                currency={account.currency}
                className="text-2xl font-semibold"
              />
              {flows && (
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 text-xs text-muted-foreground">
                  {FLOWS.filter(({ minor }) => flows[minor] !== 0).map(({ key, minor, sign }) => (
                    <div key={key} className="contents">
                      <dt>{t(key)}</dt>
                      <dd className="tabular text-right">
                        {formatMoney(sign * flows[minor], account.currency, locale, {
                          signDisplay: 'exceptZero',
                        })}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
