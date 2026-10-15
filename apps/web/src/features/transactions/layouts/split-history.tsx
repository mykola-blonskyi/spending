import { ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router';
import { useTranslations } from '@i18n/index';
import { cn } from '@shared/lib/utils';
import { Input } from '@shared/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import {
  ActiveChips,
  CategoryGlyph,
  FilterSheet,
  MasterDetail,
  SyncMarker,
  TotalsLine,
  DayNets,
  EntryAmount,
} from '../blocks';
import type { DayItem, EntryRow, HistoryKind } from '../history-model';
import { type History, useHistory } from '../use-history';

const ring = 'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60';
const chip =
  'h-9 shrink-0 rounded-md border bg-card px-2.5 text-[13px] font-medium transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] lg:h-7';

function Day({ day }: { day: DayItem }) {
  return (
    <div className="flex h-8 items-end justify-between gap-3 px-4 pb-1.5 text-[12px] font-medium text-muted-foreground">
      <h2>{day.label}</h2>
      <DayNets totals={day.totals} />
    </div>
  );
}

function Row({ row, selected }: { row: EntryRow; selected: boolean }) {
  const sub = selected ? 'text-accent-foreground/75' : 'text-muted-foreground';
  return (
    <div className="px-2">
      <Link
        to={row.href}
        data-sync={row.sync.state}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'relative flex min-h-14 items-center gap-3 rounded-md px-2 py-2 transition-colors duration-150 lg:min-h-12 lg:py-1.5',
          selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/70',
          ring,
        )}
      >
        {selected && (
          <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
        )}
        <CategoryGlyph category={row.category} className={cn(selected && 'bg-card/70')} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium">{row.title}</span>
            <SyncMarker sync={row.sync} className="shrink-0" />
          </span>
          {row.subtitle && (
            <span className={cn('mt-0.5 block truncate text-[13px]', sub)}>{row.subtitle}</span>
          )}
        </span>
        <EntryAmount
          row={row}
          colored={false}
          className={cn('font-medium', row.kind === 'income' && 'text-income')}
          secondaryClassName={selected ? 'text-accent-foreground/75' : undefined}
        />
        <ChevronRight aria-hidden className={cn('size-4 shrink-0 lg:hidden', sub)} />
      </Link>
    </div>
  );
}

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

function Header({ history }: { history: History }) {
  const t = useTranslations();
  const searchId = useId();
  const search = useRef<HTMLInputElement>(null);
  const { filters, setFilter } = history;
  const count = history.items.filter((item) => item.type === 'entry').length;
  const activeCount = history.chips.length;

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || isTyping(event.target)) return;
      event.preventDefault();
      search.current?.focus();
    };
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  return (
    <header className="border-b bg-background px-4 lg:shrink-0">
      <div className="flex h-14 items-center justify-between gap-3 lg:h-12">
        <h1 className="text-[20px] font-semibold tracking-tight lg:text-[15px]">
          {t('pages.transactions.title')}
        </h1>
        {history.status === 'ready' && (
          <span className="text-[13px] text-muted-foreground tabular">
            {t('history.detail.count', { count })}
          </span>
        )}
      </div>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <label htmlFor={searchId} className="sr-only">
          {t('pages.transactions.searchLabel')}
        </label>
        <Input
          ref={search}
          id={searchId}
          type="search"
          aria-keyshortcuts="/"
          value={filters.text}
          placeholder={t('pages.transactions.searchPlaceholder')}
          onChange={(event) => setFilter('text', event.target.value)}
          className="h-11 rounded-lg border-input/50 bg-card pr-10 pl-9 lg:h-9"
        />
        <kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2 hidden h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded border bg-card px-1 font-sans text-[11px] leading-none font-medium text-muted-foreground lg:inline-flex"
        >
          /
        </kbd>
      </div>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
        <ToggleGroup
          type="single"
          spacing={1}
          aria-label={t('pages.transactions.kindFilter')}
          value={filters.kind}
          onValueChange={(kind) => kind && setFilter('kind', kind as HistoryKind)}
          className="gap-1.5"
        >
          {history.kindOptions.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className={cn(
                chip,
                'data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background',
              )}
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FilterSheet
          history={history}
          trigger={
            <button
              type="button"
              aria-label={t('history.openFilters', { count: activeCount })}
              className={cn(chip, ring, 'flex items-center gap-1.5 hover:bg-muted')}
            >
              <SlidersHorizontal aria-hidden className="size-3.5" />
              {t('history.filters')}
              {activeCount > 0 && <span className="text-primary tabular">{activeCount}</span>}
            </button>
          }
        />
        <ActiveChips
          chips={history.chips}
          className="flex-nowrap gap-1.5 lg:flex-wrap"
          chipClassName="h-9 rounded-md lg:h-7"
        />
      </div>
      <TotalsLine totals={history.totals} className="pb-2.5 text-[13px]" />
    </header>
  );
}

/** Split view: a dense list pane beside the selected entry, each in its own scroll area. */
export function SplitHistory() {
  const history = useHistory();
  return (
    <MasterDetail
      history={history}
      header={<Header history={history} />}
      scroll="self"
      estimate={{ day: 32, entry: 56 }}
      renderDay={(day) => <Day day={day} />}
      renderEntry={(row, _position, selected) => <Row row={row} selected={selected} />}
      className="lg:-m-6 lg:h-[calc(100%+3rem)] lg:min-h-0"
      listClassName="lg:h-full lg:min-h-0 lg:border-r"
      statusClassName="m-4"
      detailClassName="lg:h-full lg:overflow-y-auto lg:bg-card"
    />
  );
}
