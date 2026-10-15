import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Account, Category, TransactionEntry } from '@data/sync';
import { AuthorBadge } from '@features/family';
import { useTranslations } from '@i18n/index';
import { MoneyText } from '@shared/components';
import { formatRelativeDay } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { SyncMarker } from './sync-marker';

const ROW_HEIGHT = 68;

function Row({
  entry,
  category,
  account,
}: {
  entry: TransactionEntry;
  category: Category | undefined;
  account: Account | undefined;
}) {
  const t = useTranslations('pages.transactions');
  const { locale } = useSharedLocale();
  const title = entry.description || category?.name || t('uncategorized');
  const details = [formatRelativeDay(entry.occurredOn, locale), category?.name, account?.name]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link
      to={`/transactions/${entry.id}`}
      data-sync={entry.sync.state}
      className="flex h-full items-center gap-3 rounded-lg px-3 transition-colors duration-150 outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/60"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{details}</span>
          <AuthorBadge entry={entry} className="shrink-0" />
          <SyncMarker sync={entry.sync} className="shrink-0" />
        </span>
      </span>
      <MoneyText
        amountMinor={entry.kind === 'expense' ? -entry.amountMinor : entry.amountMinor}
        currency={entry.currency}
        colored
        className="text-sm font-medium"
      />
    </Link>
  );
}

/** History rows, virtualized against the page scroll so thousands of entries stay smooth. */
export function TransactionList({
  entries,
  accounts,
  categories,
  label,
}: {
  entries: readonly TransactionEntry[];
  accounts: readonly Account[];
  categories: readonly Category[];
  label: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    setScrollMargin(top + window.scrollY);
  }, []);

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const virtualizer = useWindowVirtualizer({
    count: entries.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    scrollMargin,
    getItemKey: (index) => entries[index]!.id,
  });

  return (
    <ul
      ref={listRef}
      aria-label={label}
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const entry = entries[item.index]!;
        return (
          <li
            key={item.key}
            className="absolute inset-x-0 top-0"
            style={{
              height: item.size,
              transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            <Row
              entry={entry}
              category={entry.categoryId ? categoriesById.get(entry.categoryId) : undefined}
              account={entry.accountId ? accountsById.get(entry.accountId) : undefined}
            />
          </li>
        );
      })}
    </ul>
  );
}
