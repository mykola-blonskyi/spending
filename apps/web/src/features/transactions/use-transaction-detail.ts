import { useMemo } from 'react';
import { useLocalTransaction } from '@data/sync';
import { toEntryRow } from './history-model';
import { useDiscardEntry, useRemoveEntry } from './use-entry-form';
import { useRowContext } from './use-history';

/** One entry read-only, for the detail pane of master-detail layouts. */
export function useTransactionDetail(id: string) {
  const { ready, entry } = useLocalTransaction(id);
  const context = useRowContext();
  const removeEntry = useRemoveEntry();
  const discardEntry = useDiscardEntry();
  const row = useMemo(() => (entry ? toEntryRow(entry, context) : undefined), [entry, context]);
  return {
    status: !ready ? 'loading' : row ? 'ready' : 'notFound',
    row,
    description: entry?.description ?? '',
    note: entry?.note ?? '',
    remove: () => removeEntry(id),
    discard: () => discardEntry(id),
  } as const;
}
