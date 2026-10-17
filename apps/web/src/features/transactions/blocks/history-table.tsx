import { type CSSProperties, useMemo } from 'react';
import { Link } from 'react-router';
import { useWorkspaces } from '@data/sync';
import { AuthorBadge } from '@features/family';
import { useTranslations } from '@i18n/index';
import { cn } from '@shared/lib/utils';
import {
  type HistoryItem,
  type TableColumn,
  type TableRow,
  tableColumns,
  toTableRows,
} from '../history-model';
import { EntryAmount } from './entry-amount';
import { SyncMarker } from './sync-marker';
import { VirtualList } from './virtual-list';

type HistoryTableProps = {
  items: readonly HistoryItem[];
  label: string;
  scroll?: 'window' | 'self';
  selectedId?: string | undefined;
  className?: string;
};

// Every row is its own grid, so tracks never size to content: they line up across rows.
const TRACKS: Record<TableColumn, string> = {
  date: 'minmax(4rem,0.8fr)',
  description: 'minmax(4rem,2fr)',
  category: 'minmax(3rem,1fr)',
  account: 'minmax(3rem,1.1fr)',
  amount: 'minmax(6rem,1fr)',
  who: 'minmax(2.5rem,0.8fr)',
  sync: 'minmax(1.25rem,0.7fr)',
};

const ROW_ESTIMATE = 45;

function Cell({
  row,
  column,
  selected,
}: {
  row: TableRow;
  column: TableColumn;
  selected: boolean;
}) {
  switch (column) {
    case 'description':
      return (
        <Link
          to={row.row.href}
          title={row.description || undefined}
          data-sync={row.row.sync.state}
          aria-current={selected ? 'true' : undefined}
          className="truncate font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-[3px] focus-visible:after:ring-ring/60 focus-visible:after:ring-inset"
        >
          {row.description || <span className="sr-only">{row.row.title}</span>}
        </Link>
      );
    case 'amount':
      // Its own container, so the amount keeps only the rate and leaves its date and source to
      // screen readers.
      return (
        <div className="@container/history flex flex-1 justify-end">
          <EntryAmount row={row.row} className="font-medium" />
        </div>
      );
    case 'who':
      return <AuthorBadge entry={row.row} className="max-w-full text-muted-foreground" />;
    case 'sync':
      return <SyncMarker sync={row.row.sync} className="max-w-full" />;
    default:
      return <span className="truncate text-muted-foreground">{row[column]}</span>;
  }
}

/**
 * The history as one flat table, newest first, on the same virtualizer as the rows. Each row is
 * a link to what the layout opens for an entry; the link's area covers the whole row.
 */
export function HistoryTable({
  items,
  label,
  scroll = 'window',
  selectedId,
  className,
}: HistoryTableProps) {
  const t = useTranslations();
  const workspaces = useWorkspaces();
  const family = workspaces.items.some((workspace) => workspace.kind === 'family');
  const columns = tableColumns(family);
  const rows = useMemo(
    () =>
      toTableRows(items, {
        uncategorized: t('pages.transactions.uncategorized'),
        transfer: t('transfer.label'),
      }),
    [items, t],
  );
  const grid = 'grid grid-cols-(--history-columns) items-center gap-x-2 px-3';
  const style = {
    '--history-columns': columns.map((column) => TRACKS[column]).join(' '),
  } as CSSProperties;

  return (
    <div
      role="table"
      aria-label={label}
      aria-rowcount={rows.length + 1}
      style={style}
      className={cn('text-sm', scroll === 'self' && 'flex h-full flex-col', className)}
    >
      <div role="rowgroup" className={cn(scroll === 'self' && 'shrink-0')}>
        <div
          role="row"
          aria-rowindex={1}
          className={cn(grid, 'h-9 border-b text-xs font-medium text-muted-foreground')}
        >
          {columns.map((column) => (
            <span
              key={column}
              role="columnheader"
              className={cn('truncate', column === 'amount' && 'text-right')}
            >
              {t(`history.columns.${column}`)}
            </span>
          ))}
        </div>
      </div>
      <div className={cn(scroll === 'self' && 'min-h-0 flex-1')}>
        <VirtualList
          items={rows}
          scroll={scroll}
          estimateSize={() => ROW_ESTIMATE}
          getItemKey={(index) => rows[index]!.row.id}
        >
          {(virtualizer) => (
            <div
              role="rowgroup"
              className="relative"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((virtual) => {
                const row = rows[virtual.index]!;
                const selected = row.row.id === selectedId;
                return (
                  <div
                    key={virtual.key}
                    role="row"
                    aria-rowindex={virtual.index + 2}
                    data-index={virtual.index}
                    ref={virtualizer.measureElement}
                    className={cn(
                      grid,
                      'absolute inset-x-0 top-0 min-h-11 border-b py-1.5 transition-colors duration-150',
                      selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
                    )}
                    style={{
                      transform: `translateY(${virtual.start - virtualizer.options.scrollMargin}px)`,
                    }}
                  >
                    {columns.map((column) => (
                      <div key={column} role="cell" className="flex min-w-0">
                        <Cell row={row} column={column} selected={selected} />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </VirtualList>
      </div>
    </div>
  );
}
