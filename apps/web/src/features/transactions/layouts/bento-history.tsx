import { CloudUpload, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
import { AuthorBadge } from '@features/family';
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
import { useHistory } from '../use-history';

const ring =
  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background';

function Day({ day }: { day: DayItem }) {
  return (
    <div className="pt-3">
      <header className="flex min-h-5 items-center justify-between gap-2 rounded-t-2xl border border-b-0 bg-card px-4 pt-4 pb-1">
        <h2 className="truncate text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {day.label}
        </h2>
        <DayNets totals={day.totals} className="text-xs text-muted-foreground" />
      </header>
    </div>
  );
}

function SyncBadge({ sync }: { sync: EntryRow['sync'] }) {
  if (sync.state === 'synced') return null;
  const pending = sync.state === 'pending';
  return (
    <span
      aria-hidden
      className={cn(
        'absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full text-[10px] leading-none font-bold text-card ring-2 ring-card',
        pending ? 'bg-warning' : 'bg-expense',
      )}
    >
      {pending ? <CloudUpload className="size-2.5" strokeWidth={2.6} /> : '!'}
    </span>
  );
}

const edges: Record<RowPosition, string> = {
  first: '',
  middle: 'border-t',
  last: 'border-t',
  only: '',
};

function Row({ row, position }: { row: EntryRow; position: RowPosition }) {
  const closing = position === 'last' || position === 'only';
  return (
    <div className={cn('border-x bg-card px-4', closing && 'rounded-b-2xl border-b pb-1.5')}>
      <Link
        to={row.href}
        data-sync={row.sync.state}
        className={cn(
          'flex min-h-14 items-center gap-3 py-2.5 transition-colors duration-150 hover:bg-muted/40',
          edges[position],
          ring,
        )}
      >
        <span className="relative shrink-0">
          <CategoryBadge category={row.category} className="size-10 rounded-lg" />
          <SyncBadge sync={row.sync} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{row.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {row.subtitle && <span className="truncate">{row.subtitle}</span>}
            <AuthorBadge entry={row} className="max-w-[45%] text-xs text-muted-foreground" />
            <SyncMarker sync={row.sync} className="font-medium" />
          </span>
        </span>
        <EntryAmount row={row} className="shrink-0 text-sm font-semibold" />
      </Link>
    </div>
  );
}

/** Bento history: a filter tile, then one rounded tile per day with divided rows. */
export function BentoHistory() {
  const t = useTranslations();
  const searchId = useId();
  const history = useHistory();
  const { filters, setFilter } = history;
  const activeCount = history.chips.length + (filters.kind === 'all' ? 0 : 1);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader
        title={t('pages.transactions.title')}
        className="mb-3 lg:mb-4"
        actions={
          <Button asChild className="max-lg:hidden">
            <Link to="/transactions/new">
              <Plus aria-hidden />
              {t('nav.addTransaction')}
            </Link>
          </Button>
        }
      />

      <section className="mb-3 flex flex-col gap-3 rounded-2xl border bg-card p-4">
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
              className="h-11 rounded-xl bg-background pl-9"
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
                className="relative size-11 rounded-xl"
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
                className="h-11 shrink-0 rounded-xl bg-muted px-3.5 text-[13px] font-medium transition-[background-color,color,transform] duration-150 ease-out hover:bg-accent active:scale-[0.97] data-[state=on]:bg-primary data-[state=on]:text-primary-foreground lg:h-9"
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ActiveChips chips={history.chips} chipClassName="rounded-xl" />
        </div>
        <TotalsLine totals={history.totals} className="text-muted-foreground" />
      </section>

      <HistoryStatus status={history.status} loaded={history.loaded} />
      {history.status === 'ready' && (
        <HistoryList
          items={history.items}
          label={t('pages.transactions.title')}
          estimate={{ day: 56, entry: 61 }}
          className="-mt-3"
          renderDay={(day) => <Day day={day} />}
          renderEntry={(row, position) => <Row row={row} position={position} />}
        />
      )}
    </div>
  );
}
