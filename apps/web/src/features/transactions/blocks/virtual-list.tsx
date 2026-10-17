import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { type Key, type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@shared/lib/utils';

type VirtualListProps = {
  items: readonly unknown[];
  /** Fill the parent's height (the split pane) instead of the viewport below the list's top. */
  fill?: boolean;
  estimateSize: (index: number) => number;
  getItemKey: (index: number) => Key;
  className?: string;
  children: (virtualizer: Virtualizer<HTMLDivElement, Element>) => ReactNode;
};

const OVERSCAN = 8;
const MIN_HEIGHT = '12rem';

/**
 * Where the box starts on the page and how much room the shell keeps below it (its `main` bottom
 * padding, which clears a phone's tab bar or floating Add button), so a box in a page that
 * scrolls fills the viewport below the controls and the page itself does not scroll: the shells
 * are not viewport-high flex columns. Measured again when `items` change, on resize, and when
 * `main` resizes (filter chips, totals or late fonts above the box).
 */
function usePageFit<T extends HTMLElement>(measure: boolean, items: unknown) {
  const ref = useRef<T>(null);
  const [fit, setFit] = useState<{ top: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!measure || !box) return;
    const main = box.closest('main');
    const update = () => {
      const top = Math.round(box.getBoundingClientRect().top + window.scrollY);
      const bottom = main ? Math.ceil(parseFloat(getComputedStyle(main).paddingBottom)) : 0;
      setFit((fit) => (fit?.top === top && fit.bottom === bottom ? fit : { top, bottom }));
    };
    update();
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (main) observer?.observe(main);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [measure, items]);
  return [ref, measure ? fit : null] as const;
}

/**
 * The only user of TanStack Virtual, so a 5,000-entry history keeps a bounded DOM. It is always
 * its own scroll box (the element virtualizer, never the window one), so the controls above it
 * stay in view; `children` draws the items in view, placed at `virtual.start`.
 */
export function VirtualList(props: VirtualListProps) {
  const [scroller, fit] = usePageFit<HTMLDivElement>(!props.fill, props.items);
  const virtualizer = useVirtualizer({
    count: props.items.length,
    estimateSize: props.estimateSize,
    getItemKey: props.getItemKey,
    overscan: OVERSCAN,
    getScrollElement: () => scroller.current,
  });
  return (
    <div
      ref={scroller}
      style={
        fit
          ? { maxHeight: `max(${MIN_HEIGHT}, calc(100dvh - ${fit.top}px - ${fit.bottom}px))` }
          : undefined
      }
      className={cn('h-full overflow-y-auto overscroll-contain', props.className)}
    >
      {props.children(virtualizer)}
    </div>
  );
}
