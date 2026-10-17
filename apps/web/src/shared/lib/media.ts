import { useCallback, useState, useSyncExternalStore } from 'react';

const DESKTOP = '(min-width: 64rem)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const isDesktop = () => window.matchMedia(DESKTOP).matches;

/** Tailwind's `lg` breakpoint, for screens whose structure (not only style) changes on desktop. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, isDesktop, () => false);
}

/**
 * A callback ref and the width of the element it is set on, kept current by ResizeObserver.
 * 0 until measured; measured once where ResizeObserver is missing (jsdom).
 */
export function useWidth<T extends Element>(): [(element: T | null) => () => void, number] {
  const [width, setWidth] = useState(0);
  const measure = useCallback((element: T | null) => {
    if (!element) return () => {};
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return () => {};
    const observer = new ResizeObserver(() => setWidth(element.getBoundingClientRect().width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [measure, width];
}
