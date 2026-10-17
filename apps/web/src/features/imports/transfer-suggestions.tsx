import { ArrowLeftRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ImportResult } from '@data/imports';
import { useAccounts, useLocalTransactions, useMarkTransfer } from '@data/sync';
import { useTranslations } from '@i18n/index';
import { MoneyText } from '@shared/components';
import { formatDate } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { Button } from '@shared/ui/button';

type Suggestion = ImportResult['imported']['transferSuggestions'][number];

const ALL = {};

/**
 * BR-38: rows the server thinks are own transfers. Confirming marks them like the history does,
 * through the sync queue; dismissing only hides the suggestion in this tab. A row marked
 * meanwhile, or whose other side became a transfer, drops out.
 */
export function TransferSuggestions({ suggestions }: { suggestions: readonly Suggestion[] }) {
  const t = useTranslations('imports.suggestions');
  const tt = useTranslations('transfer');
  const { locale } = useSharedLocale();
  const all = useLocalTransactions(ALL);
  const accounts = useAccounts();
  const mark = useMarkTransfer();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const open = useMemo(() => {
    const byId = new Map(all.items.map((entry) => [entry.id, entry]));
    return suggestions.flatMap((suggestion) => {
      const entry = byId.get(suggestion.transactionId);
      const counterpart = suggestion.counterpartId ? byId.get(suggestion.counterpartId) : null;
      if (!entry || entry.transferId !== null || dismissed.has(entry.id)) return [];
      if (counterpart === undefined || counterpart?.transferId) return [];
      return [{ suggestion, entry, counterpart }];
    });
  }, [all.items, suggestions, dismissed]);
  const accountName = (id: string | null) => accounts.items.find((a) => a.id === id)?.name ?? '';

  if (open.length === 0) return null;
  const confirm = (suggestion: Suggestion) =>
    mark(suggestion.transactionId, suggestion.counterpartId);
  const confirmAll = async () => {
    for (const { suggestion } of open) await confirm(suggestion);
  };

  return (
    <section aria-labelledby="transfer-suggestions" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex flex-col gap-0.5">
          <h2 id="transfer-suggestions" className="text-sm font-medium text-muted-foreground">
            {t('title')}
          </h2>
          <p className="text-xs text-pretty text-muted-foreground">{t('hint')}</p>
        </div>
        {open.length > 1 && (
          <Button size="sm" onClick={() => void confirmAll()}>
            {t('confirmAll')}
          </Button>
        )}
      </div>
      <ul className="divide-y rounded-xl border">
        {open.map(({ suggestion, entry, counterpart }) => (
          <li
            key={entry.id}
            aria-label={t('item', { description: entry.description })}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm"
          >
            <ArrowLeftRight aria-hidden className="size-4 shrink-0 text-primary" />
            <div className="min-w-48 flex-1">
              <span className="block truncate font-medium">{entry.description}</span>
              <span className="block text-xs text-muted-foreground">
                {counterpart
                  ? t('otherSide', {
                      account: accountName(counterpart.accountId),
                      date: formatDate(counterpart.occurredOn, locale),
                    })
                  : tt('outside')}
              </span>
            </div>
            <MoneyText
              amountMinor={entry.kind === 'expense' ? -entry.amountMinor : entry.amountMinor}
              currency={entry.currency}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDismissed((prev) => new Set(prev).add(entry.id))}
              >
                {t('dismiss')}
              </Button>
              <Button size="sm" onClick={() => void confirm(suggestion)}>
                {t('confirm')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
