import { describe, expect, it } from 'vitest';
import { sequentialIds, serverRow, syncedState } from './fixtures';
import { queueOrder } from './model';
import { reducePush } from './push';
import { localEntries } from './query';
import { markTransfer, unmarkTransfer } from './transfer';

const now = '2026-10-15T12:00:00.000Z';
const out = serverRow({
  id: 'out',
  kind: 'expense',
  accountId: 'card',
  categoryId: 'cat',
  version: 2,
});
const into = serverRow({ id: 'in', kind: 'income', accountId: 'savings', version: 4 });

const upserts = (state: ReturnType<typeof syncedState>) =>
  queueOrder(state).map((m) => ({
    id: m.transactionId,
    base: m.baseVersion,
    ...(m.change.type === 'transaction.upsert' &&
      (({ transferId, transferOutside, categoryId }) => ({
        transferId,
        transferOutside,
        categoryId,
      }))(m.change.transaction)),
  }));

describe('transfer reducers (BR-37)', () => {
  it('queues both sides as ordinary upserts on their own base versions', () => {
    const marked = markTransfer(syncedState(out, into), 'out', 'in', 'tr-1', sequentialIds());
    expect(upserts(marked)).toEqual([
      { id: 'out', base: 2, transferId: 'tr-1', transferOutside: false, categoryId: null },
      { id: 'in', base: 4, transferId: 'tr-1', transferOutside: false, categoryId: null },
    ]);
    expect(localEntries(marked).map((e) => e.transferId)).toEqual(['tr-1', 'tr-1']);
  });

  it('marks one entry as a transfer to an own account outside the app', () => {
    const marked = markTransfer(syncedState(out, into), 'out', null, 'tr-1', sequentialIds());
    expect(upserts(marked)).toEqual([
      { id: 'out', base: 2, transferId: 'tr-1', transferOutside: true, categoryId: null },
    ]);
  });

  it('unmarks every side, still queued, back to entries awaiting a category', () => {
    const marked = markTransfer(syncedState(out, into), 'out', 'in', 'tr-1', sequentialIds());
    const unmarked = unmarkTransfer(marked, 'in', sequentialIds('n'));
    // The still-queued mutations take the new payload, so nothing extra is sent.
    expect(upserts(unmarked)).toEqual([
      { id: 'out', base: 2, transferId: null, transferOutside: false, categoryId: null },
      { id: 'in', base: 4, transferId: null, transferOutside: false, categoryId: null },
    ]);
  });

  it('unmarks synced sides found by their shared transfer id', () => {
    const linked = syncedState(
      { ...out, categoryId: null, transferId: 'tr-1' },
      { ...into, transferId: 'tr-1' },
      serverRow({ id: 'other' }),
    );
    expect(upserts(unmarkTransfer(linked, 'out', sequentialIds())).map((u) => u.id)).toEqual([
      'out',
      'in',
    ]);
    expect(unmarkTransfer(syncedState(out), 'out', sequentialIds()).mutations.size).toBe(0);
  });

  it('keeps a conflicting side on the server row while the other side links', () => {
    const marked = markTransfer(syncedState(out, into), 'out', 'in', 'tr-1', sequentialIds());
    const next = reducePush(
      marked,
      [
        {
          mutationId: 'm-1',
          status: 'conflict',
          conflictId: 'c-1',
          transaction: { ...out, amountMinor: 999, version: 3 },
        },
        {
          mutationId: 'm-2',
          status: 'applied',
          transaction: { ...into, transferId: 'tr-1', version: 5 },
        },
      ],
      now,
      ['m-1', 'm-2'],
    );
    expect(next.conflicts.get('c-1')).toMatchObject({
      transactionId: 'out',
      local: { transferId: 'tr-1', categoryId: null },
    });
    expect(localEntries(next)).toMatchObject([
      { id: 'out', transferId: null, amountMinor: 999, sync: { state: 'conflict' } },
      { id: 'in', transferId: 'tr-1', sync: { state: 'synced' } },
    ]);
  });
});
