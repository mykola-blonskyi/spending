import { useSyncExternalStore } from 'react';

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
