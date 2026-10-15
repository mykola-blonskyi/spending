import { useVirtualizer, useWindowVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@shared/lib/utils';
import type { DayItem, EntryRow, HistoryItem, RowPosition } from '../history-model';

type HistoryListProps = {
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
const OVERSCAN = 8;

function options(props: HistoryListProps) {
  const estimate = props.estimate ?? DEFAULT_ESTIMATE;
  return {
    count: props.items.length,
    estimateSize: (index: number) =>
      props.items[index]?.type === 'day' ? estimate.day : estimate.entry,
    getItemKey: (index: number) => props.items[index]!.key,
    overscan: OVERSCAN,
  };
}

function Items<S extends Element | Window>({
  virtualizer,
  props,
}: {
  virtualizer: Virtualizer<S, Element>;
  props: HistoryListProps;
}) {
  const offset = virtualizer.options.scrollMargin;
  return (
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
            style={{ transform: `translateY(${virtual.start - offset}px)` }}
          >
            {item.type === 'day'
              ? props.renderDay(item)
              : props.renderEntry(item.row, item.position, item.row.id === props.selectedId)}
          </li>
        );
      })}
    </ul>
  );
}

function WindowList(props: HistoryListProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // Filters that change the items also change what sits above the list (chips, totals).
  useLayoutEffect(() => {
    setScrollMargin((anchor.current?.getBoundingClientRect().top ?? 0) + window.scrollY);
  }, [props.items]);
  const virtualizer = useWindowVirtualizer({ ...options(props), scrollMargin });
  return (
    <div ref={anchor}>
      <Items virtualizer={virtualizer} props={props} />
    </div>
  );
}

function SelfList(props: HistoryListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    ...options(props),
    getScrollElement: () => scroller.current,
  });
  return (
    <div ref={scroller} className="h-full overflow-y-auto overscroll-contain">
      <Items virtualizer={virtualizer} props={props} />
    </div>
  );
}

/**
 * History rows and day headers, virtualized so a 5,000-entry history keeps a bounded DOM. The
 * only user of the virtualizer; layouts style rows through the render props.
 */
export function HistoryList(props: HistoryListProps) {
  return props.scroll === 'self' ? <SelfList {...props} /> : <WindowList {...props} />;
}
