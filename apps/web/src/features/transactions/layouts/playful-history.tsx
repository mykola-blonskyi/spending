import { Search, SlidersHorizontal } from 'lucide-react';
import { useId, useMemo } from 'react';
import { Link } from 'react-router';
import { AuthorBadge } from '@features/family';
import { useTranslations } from '@i18n/index';
import { PageHeader } from '@shared/components';
import { cn } from '@shared/lib/utils';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import {
  ActiveChips,
  CategoryBadge,
  FilterSheet,
  HistoryList,
  HistoryStatus,
  SyncMarker,
  TotalsLine,
  DayNets,
  EntryAmount,
} from '../blocks';
import type { DayItem, EntryRow, HistoryKind, RowPosition } from '../history-model';
import { useHistory } from '../use-history';

const ring =
  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const control = 'rounded-2xl border border-input/50 bg-card';

function Day({ day }: { day: DayItem }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 pt-5 pb-2">
      <h2 className="flex items-center gap-2 text-[13px] font-bold">
        <span aria-hidden className="size-1.5 rounded-full bg-primary" />
        {day.label}
      </h2>
      <DayNets totals={day.totals} className="text-xs font-medium text-muted-foreground" />
    </div>
  );
}

const frame: Record<RowPosition, string> = {
  only: 'rounded-2xl border py-1',
  first: 'rounded-t-2xl border-x border-t pt-1',
  middle: 'border-x',
  last: 'rounded-b-2xl border-x border-b pb-1',
};

function Row({ row, position, tilted }: { row: EntryRow; position: RowPosition; tilted: boolean }) {
  return (
    <div className={cn('bg-card px-1.5', frame[position])}>
      <Link
        to={row.href}
        data-sync={row.sync.state}
        className={cn(
          'flex items-center gap-3.5 rounded-xl px-2.5 py-3 transition-colors duration-150 hover:bg-muted',
          ring,
        )}
      >
        <CategoryBadge
          category={row.category}
          className={cn('size-10 rounded-xl', tilted ? 'rotate-3' : '-rotate-3')}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[15px] font-bold tracking-tight">{row.title}</span>
            <AuthorBadge entry={row} className="max-w-[45%] text-xs text-muted-foreground" />
          </span>
          {row.subtitle && (
            <span className="truncate text-[13px] text-muted-foreground">{row.subtitle}</span>
          )}
          <SyncMarker
            sync={row.sync}
            className="mt-1 h-5 w-fit max-w-full rounded-md px-1.5 text-[11px] font-semibold data-[sync=conflict]:bg-destructive/10 data-[sync=failed]:bg-destructive/10 data-[sync=pending]:bg-warning/15"
          />
        </span>
        <EntryAmount row={row} className="shrink-0 text-[15px] font-bold tracking-tight" />
      </Link>
    </div>
  );
}

/** Playful history: tilted sticker icons in bordered day cards, bold titles. */
export function PlayfulHistory() {
  const t = useTranslations();
  const searchId = useId();
  const history = useHistory();
  const { filters, setFilter } = history;
  const activeCount = history.chips.length;
  // Stickers alternate their tilt down the list.
  const tilts = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const item of history.items)
      if (item.type === 'entry') map.set(item.row.id, map.size % 2 === 1);
    return map;
  }, [history.items]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <PageHeader
        title={t('pages.transactions.title')}
        description={t('pages.transactions.description')}
        className="mb-2 [&_h1]:font-bold"
      />
      <div className="flex gap-2">
        <label
          htmlFor={searchId}
          className={cn(
            'flex h-12 min-w-0 flex-1 items-center gap-2.5 px-4 text-muted-foreground focus-within:ring-[3px] focus-within:ring-ring/60',
            control,
          )}
        >
          <Search aria-hidden className="size-[18px] shrink-0" />
          <span className="sr-only">{t('pages.transactions.searchLabel')}</span>
          <input
            id={searchId}
            type="search"
            value={filters.text}
            placeholder={t('pages.transactions.searchPlaceholder')}
            onChange={(event) => setFilter('text', event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <FilterSheet
          history={history}
          trigger={
            <button
              type="button"
              aria-label={t('history.openFilters', { count: activeCount })}
              className={cn(
                'relative flex size-12 shrink-0 items-center justify-center transition-transform duration-150 ease-out active:scale-[0.97]',
                control,
                ring,
              )}
            >
              <SlidersHorizontal aria-hidden className="size-[18px]" />
              {activeCount > 0 && (
                <span
                  aria-hidden
                  className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground tabular"
                >
                  {activeCount}
                </span>
              )}
            </button>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          spacing={2}
          aria-label={t('pages.transactions.kindFilter')}
          value={filters.kind}
          onValueChange={(kind) => kind && setFilter('kind', kind as HistoryKind)}
        >
          {history.kindOptions.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className="h-11 rounded-full border bg-card px-4 text-sm font-semibold transition-[background-color,color,transform] duration-150 ease-out hover:bg-card active:scale-[0.97] data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background data-[state=on]:hover:bg-foreground"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ActiveChips chips={history.chips} chipClassName="h-11 px-4 text-sm font-semibold" />
      </div>

      <TotalsLine totals={history.totals} />
      <HistoryStatus status={history.status} loaded={history.loaded} />
      {history.status === 'ready' && (
        <HistoryList
          items={history.items}
          label={t('pages.transactions.title')}
          estimate={{ day: 44, entry: 70 }}
          renderDay={(day) => <Day day={day} />}
          renderEntry={(row, position) => (
            <Row row={row} position={position} tilted={tilts.get(row.id) ?? false} />
          )}
        />
      )}
    </div>
  );
}
