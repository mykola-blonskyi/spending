import { Search, SlidersHorizontal } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
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
const raised = 'shadow-[0_1px_2px_color-mix(in_oklch,var(--foreground)_4%,transparent)]';

function Day({ day }: { day: DayItem }) {
  return (
    <div className="flex items-center gap-3 pt-5 pb-3">
      <h2 className="flex h-8 items-center rounded-full bg-card px-3.5 text-sm font-semibold">
        {day.label}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-border" />
      <DayNets totals={day.totals} className="text-sm text-muted-foreground" />
    </div>
  );
}

const frame: Record<RowPosition, string> = {
  only: 'rounded-2xl py-1.5',
  first: 'rounded-t-2xl pt-1.5',
  middle: '',
  last: 'rounded-b-2xl pb-1.5',
};

function Row({ row, position }: { row: EntryRow; position: RowPosition }) {
  return (
    <div className={cn('bg-card px-1.5', raised, frame[position])}>
      <Link
        to={row.href}
        data-sync={row.sync.state}
        className={cn(
          'flex min-h-[4.5rem] items-center gap-3.5 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-muted',
          ring,
        )}
      >
        <CategoryBadge category={row.category} className="size-11" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{row.title}</span>
            <SyncMarker
              sync={row.sync}
              className="h-6 shrink-0 rounded-full px-2 font-medium data-[sync=conflict]:bg-destructive/10 data-[sync=failed]:bg-destructive/10 data-[sync=pending]:bg-warning/15"
            />
          </span>
          {row.subtitle && (
            <span className="truncate text-sm text-muted-foreground">{row.subtitle}</span>
          )}
        </span>
        <EntryAmount row={row} className="shrink-0 font-semibold tracking-tight" />
      </Link>
    </div>
  );
}

/** Soft history: pill search, pill chips, pill day headers over card lists. */
export function SoftHistory() {
  const t = useTranslations();
  const searchId = useId();
  const history = useHistory();
  const { filters, setFilter } = history;
  const activeCount = history.chips.length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <PageHeader
        title={t('pages.transactions.title')}
        description={t('pages.transactions.description')}
        className="mb-2"
      />
      <div className="flex gap-2.5">
        <label
          htmlFor={searchId}
          className={cn(
            'flex h-14 min-w-0 flex-1 items-center gap-3 rounded-full bg-card px-5 focus-within:ring-[3px] focus-within:ring-ring/60',
            raised,
          )}
        >
          <Search aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <span className="sr-only">{t('pages.transactions.searchLabel')}</span>
          <input
            id={searchId}
            type="search"
            value={filters.text}
            placeholder={t('pages.transactions.searchPlaceholder')}
            onChange={(event) => setFilter('text', event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </label>
        <FilterSheet
          history={history}
          trigger={
            <button
              type="button"
              aria-label={t('history.openFilters', { count: activeCount })}
              className={cn(
                'relative flex size-14 shrink-0 items-center justify-center rounded-full bg-card transition-transform duration-150 ease-out active:scale-[0.97]',
                raised,
                ring,
              )}
            >
              <SlidersHorizontal aria-hidden className="size-5" />
              {activeCount > 0 && (
                <span
                  aria-hidden
                  className="absolute top-0 right-0 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground tabular"
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
              className="h-11 rounded-full bg-card px-5 text-[15px] font-medium transition-[background-color,color,transform] duration-150 ease-out hover:bg-card active:scale-[0.97] data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ActiveChips chips={history.chips} chipClassName="h-11 px-4 text-[15px]" />
      </div>

      <TotalsLine totals={history.totals} />
      <HistoryStatus status={history.status} loaded={history.loaded} />
      {history.status === 'ready' && (
        <HistoryList
          items={history.items}
          label={t('pages.transactions.title')}
          estimate={{ day: 64, entry: 78 }}
          renderDay={(day) => <Day day={day} />}
          renderEntry={(row, position) => <Row row={row} position={position} />}
        />
      )}
    </div>
  );
}
