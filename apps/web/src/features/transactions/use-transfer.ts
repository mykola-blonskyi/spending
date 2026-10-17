import { useMemo } from 'react';
import {
  type TransactionFilter,
  useLocalTransactions,
  useMarkTransfer,
  useUnmarkTransfer,
} from '@data/sync';
import { toEntryRow, transferCandidates } from './history-model';
import { useRowContext } from './use-history';

const EVERY_ENTRY: TransactionFilter = {};

/** One entry's transfer mark: its other side, the entries that could be it, and the writes (BR-36). */
export function useTransfer(id: string) {
  const all = useLocalTransactions(EVERY_ENTRY);
  const context = useRowContext();
  const mark = useMarkTransfer();
  const unmark = useUnmarkTransfer();
  return useMemo(() => {
    const entry = all.items.find((item) => item.id === id);
    const transferId = entry?.transferId ?? null;
    const counterpart = transferId
      ? all.items.find((item) => item.transferId === transferId && item.id !== id)
      : undefined;
    return {
      isTransfer: transferId !== null,
      outside: entry?.transferOutside ?? false,
      counterpart: counterpart && toEntryRow(counterpart, context),
      candidates: entry
        ? transferCandidates(entry, all.items).map((item) => toEntryRow(item, context))
        : [],
      mark: (counterpartId: string | null) => mark(id, counterpartId),
      unmark: () => unmark(id),
    };
  }, [all.items, id, context, mark, unmark]);
}
