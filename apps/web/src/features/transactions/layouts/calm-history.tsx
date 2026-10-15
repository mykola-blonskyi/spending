import { Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
import { useTranslations } from '@i18n/index';
import { PageHeader } from '@shared/components';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
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
import { type History, useHistory } from '../use-history';

const ring =
  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export function CalmDay({ day }: { day: DayItem }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1 pt-5 pb-1.5 text-xs text-muted-foreground">
      <h2 className="font-medium">{day.label}</h2>
      <DayNets totals={day.totals} />
    </div>
  );
}

const edges: Record<RowPosition, string> = {
  only: 'rounded-xl border-t',
  first: 'rounded-t-xl border-t',
  middle: '',
  last: 'rounded-b-xl',
};

export function CalmRow({
  row,
  position,
  selected = false,
}: {
  row: EntryRow;
  position: RowPosition;
  selected?: boolean;
}) {
  return (
    <Link
      to={row.href}
      data-sync={row.sync.state}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'relative flex min-h-15 items-center gap-3 border-x border-b px-3 py-2.5 transition-colors duration-150 focus-visible:z-10',
        selected ? 'bg-accent text-accent-foreground' : 'bg-card hover:bg-muted/60',
        edges[position],
        ring,
      )}
    >
      {selected && (
        <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
      )}
      <CategoryBadge category={row.category} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{row.title}</span>
          <SyncMarker sync={row.sync} className="shrink-0" />
        </span>
        {row.subtitle && (
          <span className="truncate text-xs text-muted-foreground">{row.subtitle}</span>
        )}
      </span>
      <EntryAmount row={row} className="text-sm font-medium" />
    </Link>
  );
}

/** Search, the filter sheet, type chips, active filters and totals. */
export function CalmToolbar({ history }: { history: History }) {
  const t = useTranslations();
  const searchId = useId();
  const { filters, setFilter } = history;
  const activeCount = history.chips.length + (filters.kind === 'all' ? 0 : 1);
  return (
    <>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <label htmlFor={searchId} className="sr-only">
            {t('pages.transactions.searchLabel')}
          </label>
          <Input
            id={searchId}
            type="search"
            value={filters.text}
            placeholder={t('pages.transactions.searchPlaceholder')}
            onChange={(event) => setFilter('text', event.target.value)}
            className="h-11 bg-card pl-9"
          />
        </div>
        <FilterSheet
          history={history}
          trigger={
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t('history.openFilters', { count: activeCount })}
              className="relative size-11 bg-card"
            >
              <SlidersHorizontal aria-hidden />
              {activeCount > 0 && (
                <span
                  aria-hidden
                  className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground tabular"
                >
                  {activeCount}
                </span>
              )}
            </Button>
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
          className="gap-2"
        >
          {history.kindOptions.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className="relative h-8 rounded-full border bg-card px-3 text-[13px] transition-[background-color,color,transform] duration-150 ease-out before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] active:scale-[0.97] data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ActiveChips chips={history.chips} />
      </div>

      <TotalsLine totals={history.totals} />
    </>
  );
}

/** Calm minimal history: search and filters on top, each day a bordered card. */
export function CalmHistory() {
  const t = useTranslations();
  const history = useHistory();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('pages.transactions.title')}
        description={t('pages.transactions.description')}
        actions={
          <Button asChild className="max-lg:hidden">
            <Link to="/transactions/new">
              <Plus aria-hidden />
              {t('nav.addTransaction')}
            </Link>
          </Button>
        }
      />

      <CalmToolbar history={history} />
      <HistoryStatus status={history.status} loaded={history.loaded} />
      {history.status === 'ready' && (
        <HistoryList
          items={history.items}
          label={t('pages.transactions.title')}
          estimate={{ day: 44, entry: 61 }}
          renderDay={(day) => <CalmDay day={day} />}
          renderEntry={(row, position) => <CalmRow row={row} position={position} />}
        />
      )}
    </div>
  );
}
