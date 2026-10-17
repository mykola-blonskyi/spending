import { Search, SlidersHorizontal } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
import { AuthorBadge } from '@features/family';
import { useTranslations } from '@i18n/index';
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

function Day({ day }: { day: DayItem }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2 text-[13px]">
      <h2 className="font-semibold">{day.label}</h2>
      <DayNets totals={day.totals} className="text-muted-foreground" />
    </div>
  );
}

const edges: Record<RowPosition, string> = {
  only: 'rounded-2xl',
  first: 'rounded-t-2xl',
  middle: '',
  last: 'rounded-b-2xl',
};

function Row({ row, position }: { row: EntryRow; position: RowPosition }) {
  const topless = position === 'first' || position === 'only';
  return (
    <Link
      to={row.href}
      data-sync={row.sync.state}
      className={cn(
        'relative flex items-stretch bg-card pl-4 shadow-sm transition-colors duration-150 hover:bg-muted/60 focus-visible:z-10',
        edges[position],
        ring,
      )}
    >
      <CategoryBadge category={row.category} className="self-center" />
      <span
        className={cn(
          'ml-3 flex min-w-0 flex-1 items-center gap-3 py-3 pr-4',
          !topless && 'border-t',
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-medium">{row.title}</span>
          {row.subtitle && (
            <span className="mt-0.5 truncate text-[13px] text-muted-foreground">
              {row.subtitle}
            </span>
          )}
          <AuthorBadge entry={row} className="max-w-[45%] text-xs text-muted-foreground" />
          <SyncMarker
            sync={row.sync}
            className="mt-1.5 w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold data-[sync=conflict]:bg-destructive/10 data-[sync=failed]:bg-destructive/10 data-[sync=pending]:bg-warning/15"
          />
        </span>
        <EntryAmount row={row} className="shrink-0 text-[15px] font-semibold" />
      </span>
    </Link>
  );
}

/** Card stack history: a large title, a pill kind control and a rounded card per day. */
export function CardsHistory() {
  const t = useTranslations();
  const searchId = useId();
  const history = useHistory();
  const { filters, setFilter } = history;
  const activeCount = history.chips.length;

  return (
    <div className="flex flex-col gap-3">
      <h1 className="pt-2 text-[32px] leading-none font-bold tracking-tight">
        {t('pages.transactions.title')}
      </h1>

      <div className="flex gap-2">
        <label
          htmlFor={searchId}
          className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-card px-3 text-muted-foreground shadow-sm focus-within:ring-[3px] focus-within:ring-ring/60"
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
                'relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-card shadow-sm transition-transform duration-150 ease-out active:scale-[0.97]',
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

      <ToggleGroup
        type="single"
        spacing={1}
        aria-label={t('pages.transactions.kindFilter')}
        value={filters.kind}
        onValueChange={(kind) => kind && setFilter('kind', kind as HistoryKind)}
        className="grid w-full grid-cols-3 gap-0 rounded-full bg-card p-1 shadow-sm"
      >
        {history.kindOptions.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            className="h-11 rounded-full text-[13px] font-medium text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-transparent active:scale-[0.97] data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary"
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <ActiveChips chips={history.chips} />

      <TotalsLine totals={history.totals} balance={history.balance} />
      <HistoryStatus status={history.status} loaded={history.loaded} />
      {history.status === 'ready' && (
        <HistoryList
          items={history.items}
          label={t('pages.transactions.title')}
          estimate={{ day: 48, entry: 68 }}
          renderDay={(day) => <Day day={day} />}
          renderEntry={(row, position) => <Row row={row} position={position} />}
        />
      )}
    </div>
  );
}
