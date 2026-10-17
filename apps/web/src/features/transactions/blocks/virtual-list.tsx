import { useVirtualizer, useWindowVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { type Key, type ReactNode, useLayoutEffect, useRef, useState } from 'react';

type VirtualListProps = {
  items: readonly unknown[];
  scroll: 'window' | 'self';
  estimateSize: (index: number) => number;
  getItemKey: (index: number) => Key;
  children: (
    virtualizer: Virtualizer<Window, Element> | Virtualizer<HTMLDivElement, Element>,
  ) => ReactNode;
};

const OVERSCAN = 8;

function options(props: VirtualListProps) {
  return {
    count: props.items.length,
    estimateSize: props.estimateSize,
    getItemKey: props.getItemKey,
    overscan: OVERSCAN,
  };
}

function WindowList(props: VirtualListProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  // Filters that change the items also change what sits above the list (chips, totals).
  useLayoutEffect(() => {
    setScrollMargin((anchor.current?.getBoundingClientRect().top ?? 0) + window.scrollY);
  }, [props.items]);
  const virtualizer = useWindowVirtualizer({ ...options(props), scrollMargin });
  return <div ref={anchor}>{props.children(virtualizer)}</div>;
}

function SelfList(props: VirtualListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    ...options(props),
    getScrollElement: () => scroller.current,
  });
  return (
    <div ref={scroller} className="h-full overflow-y-auto overscroll-contain">
      {props.children(virtualizer)}
    </div>
  );
}

/**
 * The only user of TanStack Virtual, so a 5,000-entry history keeps a bounded DOM: `children`
 * draws the items in view, placed at `virtual.start - scrollMargin`.
 */
export function VirtualList(props: VirtualListProps) {
  return props.scroll === 'self' ? <SelfList {...props} /> : <WindowList {...props} />;
}
