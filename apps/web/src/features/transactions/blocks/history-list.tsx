import type { ReactNode } from 'react';
import { useTranslations } from '@i18n/index';
import { useIsDesktop } from '@shared/lib/media';
import { cn } from '@shared/lib/utils';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import type { DayItem, EntryRow, HistoryItem, RowPosition } from '../history-model';
import { type HistoryView, setHistoryView, useHistoryView } from '../history-view';
import { HistoryTable } from './history-table';
import { VirtualList } from './virtual-list';

export type HistoryListProps = {
  items: readonly HistoryItem[];
  label: string;
  /** `self` scrolls its own box filling the parent (the split pane); `window` scrolls the page. */
  scroll?: 'window' | 'self';
  /** First-paint guesses in px; real heights are measured. */
  estimate?: { day: number; entry: number };
  selectedId?: string | undefined;
  renderDay: (day: DayItem) => ReactNode;
  renderEntry: (row: EntryRow, position: RowPosition, selected: boolean) => ReactNode;
  className?: string;
};

const DEFAULT_ESTIMATE = { day: 40, entry: 64 };

function Rows(props: HistoryListProps) {
  const estimate = props.estimate ?? DEFAULT_ESTIMATE;
  return (
    <VirtualList
      items={props.items}
      scroll={props.scroll ?? 'window'}
      estimateSize={(index) => (props.items[index]?.type === 'day' ? estimate.day : estimate.entry)}
      getItemKey={(index) => props.items[index]!.key}
    >
      {(virtualizer) => (
        <ul
          aria-label={props.label}
          className={cn('@container/history relative', props.className)}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtual) => {
            const item = props.items[virtual.index]!;
            return (
              <li
                key={virtual.key}
                data-index={virtual.index}
                ref={virtualizer.measureElement}
                className="absolute inset-x-0 top-0"
                style={{
                  transform: `translateY(${virtual.start - virtualizer.options.scrollMargin}px)`,
                }}
              >
                {item.type === 'day'
                  ? props.renderDay(item)
                  : props.renderEntry(item.row, item.position, item.row.id === props.selectedId)}
              </li>
            );
          })}
        </ul>
      )}
    </VirtualList>
  );
}

function ViewSwitch({ view, className }: { view: HistoryView; className?: string }) {
  const t = useTranslations('history.view');
  return (
    <div className={cn('flex justify-end', className)}>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label={t('label')}
        value={view}
        onValueChange={(value) => value && setHistoryView(value as HistoryView)}
      >
        <ToggleGroupItem value="rows">{t('rows')}</ToggleGroupItem>
        <ToggleGroupItem value="table">{t('table')}</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

/**
 * History rows under day headers. On desktop a switch above swaps them for the flat history
 * table; the choice is kept on the device.
 */
export function HistoryList(props: HistoryListProps) {
  const desktop = useIsDesktop();
  const view = useHistoryView();
  if (!desktop) return <Rows {...props} />;
  const self = props.scroll === 'self';
  return (
    <div className={cn(self && 'flex h-full flex-col')}>
      <ViewSwitch view={view} className={self ? 'px-4 py-2' : 'pb-2'} />
      <div className={cn(self && 'min-h-0 flex-1')}>
        {view === 'table' ? (
          <HistoryTable key="table" {...props} />
        ) : (
          <Rows key="rows" {...props} />
        )}
      </div>
    </div>
  );
}
