import { useMemo } from 'react';
import { useLocalTransactions } from '@data/sync';
import { positionOf, toHistoryRows } from './history-model';
import { CalmRow } from './layouts/calm-history';
import { useRowContext } from './use-history';

const EVERY_ENTRY = {};

/** Entries whose change is waiting to be sent, or was refused, as history rows to open and fix. */
export function UnsyncedEntries({ state }: { state: 'pending' | 'failed' }) {
  const transactions = useLocalTransactions(EVERY_ENTRY);
  const context = useRowContext();
  const rows = useMemo(
    () =>
      toHistoryRows(transactions.items, context, false).filter((row) => row.sync.state === state),
    [transactions.items, context, state],
  );
  if (rows.length === 0) return null;
  return (
    <ul>
      {rows.map((row, index) => (
        <li key={row.id}>
          <CalmRow row={row} position={positionOf(index, rows.length)} />
        </li>
      ))}
    </ul>
  );
}
