import { Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
import { AuthorBadge } from '@features/family';
import { useTranslations } from '@i18n/index';
import { PageHeader } from '@shared/components';
import { cn } from '@shared/lib/utils';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import {
  ActiveChips,
  FilterSheet,
  HistoryList,
  HistoryStatus,
  SyncMarker,
  TotalsLine,
  DayNets,
  EntryAmount,
} from '../blocks';
import type { DayItem, EntryRow, HistoryKind } from '../history-model';
import { useHistory } from '../use-history';

const ring =
  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/** Each row draws its own slice of the hairline, so the virtualized list still reads as one line. */
const line = 'before:absolute before:inset-y-0 before:left-[11px] before:w-px before:bg-border';

function Day({ day }: { day: DayItem }) {
  return (
    <div className={cn('relative pt-7 pb-1', line, 'before:top-[35px]')}>
      <span
        aria-hidden
        className="absolute top-[35px] left-[7px] size-[9px] rounded-full bg-foreground ring-4 ring-background"
      />
      <div className="flex items-baseline justify-between gap-3 pl-9">
        <h2 className="font-serif text-[19px] font-semibold">{day.label}</h2>
        <DayNets totals={day.totals} className="text-[13px] text-muted-foreground" />
      </div>
    </div>
  );
}

function Marker({ row }: { row: EntryRow }) {
  if (row.sync.state === 'synced') return null;
  return (
    <span
      aria-hidden
      className={cn(
        'absolute top-[18px] left-[7px] size-[9px] rounded-full ring-4 ring-background',
        row.sync.state === 'pending'
          ? 'border-[1.5px] border-muted-foreground bg-background'
          : 'bg-expense',
      )}
    />
  );
}

function Row({ row }: { row: EntryRow }) {
  return (
    <div className={cn('relative', line)}>
      <Marker row={row} />
      <Link
        to={row.href}
        data-sync={row.sync.state}
        className={cn(
          'relative flex min-h-14 items-start gap-4 py-2.5 pr-1 pl-9 transition-colors duration-150 hover:bg-muted/50',
          ring,
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-medium">{row.title}</span>
          {row.subtitle && (
            <span className="truncate text-[13px] text-muted-foreground">{row.subtitle}</span>
          )}
          <AuthorBadge entry={row} className="max-w-[45%] text-xs text-muted-foreground" />
          <SyncMarker sync={row.sync} className="mt-0.5 italic" />
        </span>
        <EntryAmount row={row} className="shrink-0 text-[15px]" />
      </Link>
    </div>
  );
}

/** Journal history: an underlined search, text chips, then days on a hairline timeline. */
export function JournalHistory() {
  const t = useTranslations();
  const searchId = useId();
  const history = useHistory();
  const { filters, setFilter } = history;
  const activeCount = history.chips.length + (filters.kind === 'all' ? 0 : 1);

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t('pages.transactions.title')}
        actions={
          <Link
            to="/transactions/new"
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.97] max-lg:hidden',
              ring,
            )}
          >
            <Plus aria-hidden className="size-4" />
            {t('nav.addTransaction')}
          </Link>
        }
        className="mb-4"
      />

      <div className="flex items-center gap-2">
        <label
          htmlFor={searchId}
          className="flex h-11 min-w-0 flex-1 items-center gap-2.5 border-b border-input/50 text-sm text-muted-foreground focus-within:border-ring"
        >
          <Search aria-hidden className="size-4 shrink-0" strokeWidth={1.8} />
          <span className="sr-only">{t('pages.transactions.searchLabel')}</span>
          <input
            id={searchId}
            type="search"
            value={filters.text}
            placeholder={t('pages.transactions.searchPlaceholder')}
            onChange={(event) => setFilter('text', event.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <FilterSheet
          history={history}
          trigger={
            <button
              type="button"
              aria-label={t('history.openFilters', { count: activeCount })}
              className={cn(
                'relative flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:text-foreground',
                ring,
              )}
            >
              <SlidersHorizontal aria-hidden className="size-4" strokeWidth={1.8} />
              {activeCount > 0 && (
                <span
                  aria-hidden
                  className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground tabular"
                >
                  {activeCount}
                </span>
              )}
            </button>
          }
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
        <ToggleGroup
          type="single"
          spacing={1}
          aria-label={t('pages.transactions.kindFilter')}
          value={filters.kind}
          onValueChange={(kind) => kind && setFilter('kind', kind as HistoryKind)}
          className="gap-1"
        >
          {history.kindOptions.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className="group h-11 rounded-full px-3 text-[13px] text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-transparent data-[state=on]:font-medium data-[state=on]:text-foreground"
            >
              <span className="border-b border-transparent pb-0.5 transition-colors duration-150 group-data-[state=on]:border-primary">
                {option.label}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ActiveChips chips={history.chips} />
      </div>

      <TotalsLine totals={history.totals} className="mt-3 text-muted-foreground" />
      <HistoryStatus status={history.status} loaded={history.loaded} className="mt-8" />
      {history.status === 'ready' && (
        <HistoryList
          items={history.items}
          label={t('pages.transactions.title')}
          estimate={{ day: 68, entry: 64 }}
          className="mt-1 pb-9"
          renderDay={(day) => <Day day={day} />}
          renderEntry={(row) => <Row row={row} />}
        />
      )}
    </div>
  );
}
