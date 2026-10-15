import { ArrowLeftRight, Plus } from 'lucide-react';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  totalsByCurrency,
  type TransactionFilter,
  useAccounts,
  useCategories,
  useInitialSync,
  useLocalTransactions,
} from '@data/sync';
import { useTranslations } from '@i18n/index';
import { EmptyState, LoadingState, MoneyText, PageHeader } from '@shared/components';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Progress } from '@shared/ui/progress';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { TransactionList } from './transaction-list';

const KINDS = ['all', 'expense', 'income'] as const;
type KindOption = (typeof KINDS)[number];

function InitialSyncProgress({ loaded }: { loaded: number }) {
  const t = useTranslations('pages.transactions');
  return (
    <div role="status" className="flex flex-col gap-2">
      <Progress aria-label={t('firstSync')} className="animate-pulse" value={null} />
      <p className="text-sm text-muted-foreground">
        {t('firstSync')} {t('firstSyncLoaded', { count: loaded })}
      </p>
    </div>
  );
}

export function TransactionsPage() {
  const t = useTranslations();
  const searchId = useId();
  const kindLabelId = useId();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<KindOption>('all');
  const deferredText = useDeferredValue(text);
  const filter = useMemo<TransactionFilter>(
    () => ({ text: deferredText, ...(kind !== 'all' && { kind }) }),
    [deferredText, kind],
  );
  const transactions = useLocalTransactions(filter);
  const accounts = useAccounts();
  const categories = useCategories();
  const initialSync = useInitialSync();
  const totals = useMemo(() => [...totalsByCurrency(transactions.items)], [transactions.items]);
  const filtered = deferredText.trim() !== '' || kind !== 'all';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('pages.transactions.title')}
        description={t('pages.transactions.description')}
        actions={
          <Button asChild>
            <Link to="/transactions/new">
              <Plus aria-hidden />
              {t('nav.addTransaction')}
            </Link>
          </Button>
        }
      />
      {initialSync.active && <InitialSyncProgress loaded={initialSync.loaded} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={searchId}>{t('pages.transactions.searchLabel')}</Label>
          <Input
            id={searchId}
            type="search"
            value={text}
            placeholder={t('pages.transactions.searchPlaceholder')}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label id={kindLabelId}>{t('pages.transactions.kindFilter')}</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            aria-labelledby={kindLabelId}
            value={kind}
            onValueChange={(value) => value && setKind(value as KindOption)}
          >
            {KINDS.map((option) => (
              <ToggleGroupItem key={option} value={option} className="px-3">
                {option === 'all'
                  ? t('pages.transactions.allKinds')
                  : t(`transactionForm.${option}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {totals.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {totals.map(([currency, sum]) => (
            <div key={currency} className="flex gap-3">
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{t('pages.transactions.totalSpent')}</dt>
                <dd>
                  <MoneyText amountMinor={sum.expense} currency={currency} />
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{t('pages.transactions.totalReceived')}</dt>
                <dd>
                  <MoneyText amountMinor={sum.income} currency={currency} />
                </dd>
              </div>
            </div>
          ))}
        </dl>
      )}

      {!transactions.ready ? (
        <LoadingState rows={6} />
      ) : transactions.items.length > 0 ? (
        <TransactionList
          entries={transactions.items}
          label={t('pages.transactions.title')}
          accounts={accounts.items}
          categories={categories.items}
        />
      ) : initialSync.active ? null : filtered ? (
        <EmptyState
          icon={ArrowLeftRight}
          title={t('pages.transactions.noMatchesTitle')}
          description={t('pages.transactions.noMatchesDescription')}
        />
      ) : (
        <EmptyState
          icon={ArrowLeftRight}
          title={t('pages.transactions.emptyTitle')}
          description={t('pages.transactions.emptyDescription')}
        />
      )}
    </div>
  );
}
