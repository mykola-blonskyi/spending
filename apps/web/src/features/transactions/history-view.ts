import { useSyncExternalStore } from 'react';
import { DEFAULT_TABLE_SORT, isSortColumn, type TableSort } from './history-model';

export type HistoryView = 'rows' | 'table';

type HistoryChoices = Readonly<{ view: HistoryView; sort: TableSort }>;

/** The history's per-device choices, kept as one object: `{view, sort}`. */
export const HISTORY_STORAGE_KEY = 'spending.history';

const DEFAULTS: HistoryChoices = { view: 'rows', sort: DEFAULT_TABLE_SORT };

const listeners = new Set<() => void>();
// The choices for this session when storage cannot keep them (private mode, blocked site data).
let unsaved: HistoryChoices | null = null;
// useSyncExternalStore needs the same object back while the stored text is unchanged.
let parsed: { text: string | null; choices: HistoryChoices } = { text: null, choices: DEFAULTS };

function parseSort(value: unknown): TableSort {
  const { column, direction } = (value ?? {}) as { column?: unknown; direction?: unknown };
  return typeof column === 'string' &&
    isSortColumn(column) &&
    (direction === 'asc' || direction === 'desc')
    ? { column, direction }
    : DEFAULT_TABLE_SORT;
}

function parseChoices(text: string | null): HistoryChoices {
  try {
    const stored = JSON.parse(text ?? 'null') as { view?: unknown; sort?: unknown } | null;
    return { view: stored?.view === 'table' ? 'table' : 'rows', sort: parseSort(stored?.sort) };
  } catch {
    return DEFAULTS;
  }
}

function readChoices(): HistoryChoices {
  if (unsaved) return unsaved;
  try {
    const text = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (text !== parsed.text) parsed = { text, choices: parseChoices(text) };
    return parsed.choices;
  } catch {
    return DEFAULTS;
  }
}

function save(patch: Partial<HistoryChoices>): void {
  const choices = { ...readChoices(), ...patch };
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(choices));
    unsaved = null;
  } catch {
    unsaved = choices;
  }
  for (const listener of listeners) listener();
}

export const setHistoryView = (view: HistoryView) => save({ view });

export const setTableSort = (sort: TableSort) => save({ sort });

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Rows or the table, as last chosen on this device. */
export function useHistoryView(): HistoryView {
  return useSyncExternalStore(
    subscribe,
    () => readChoices().view,
    () => DEFAULTS.view,
  );
}

/** The table's sort, as last chosen on this device. */
export function useTableSort(): TableSort {
  return useSyncExternalStore(
    subscribe,
    () => readChoices().sort,
    () => DEFAULTS.sort,
  );
}
