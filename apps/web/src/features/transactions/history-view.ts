import { useSyncExternalStore } from 'react';

export type HistoryView = 'rows' | 'table';

/** The history's per-device choices, kept as one object so later ones join the view. */
export const HISTORY_STORAGE_KEY = 'spending.history';

const listeners = new Set<() => void>();
// The choice for this session when storage cannot keep it (private mode, blocked site data).
let unsaved: HistoryView | null = null;

function readView(): HistoryView {
  if (unsaved) return unsaved;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) ?? 'null');
    return (stored as { view?: unknown } | null)?.view === 'table' ? 'table' : 'rows';
  } catch {
    return 'rows';
  }
}

export function setHistoryView(view: HistoryView): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ view }));
    unsaved = null;
  } catch {
    unsaved = view;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Rows or the table, as last chosen on this device. */
export function useHistoryView(): HistoryView {
  return useSyncExternalStore(subscribe, readView, () => 'rows');
}
