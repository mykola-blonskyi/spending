import {
  emptyLocalState,
  type LocalState,
  type LocalTransaction,
  type PullPage,
  type ServerTransaction,
  type Tombstone,
  type Workspace,
} from './model';

export const PERSONAL: Workspace = {
  id: 'ws-personal',
  kind: 'personal',
  name: 'Ann',
  role: 'owner',
};
export const FAMILY: Workspace = { id: 'ws-family', kind: 'family', name: 'Home', role: 'member' };

export function localRow(patch: Partial<LocalTransaction> = {}): LocalTransaction {
  return {
    id: 'tx-1',
    workspaceId: PERSONAL.id,
    kind: 'expense',
    amountMinor: 1250,
    currency: 'EUR',
    occurredOn: '2026-10-14',
    accountId: null,
    categoryId: null,
    description: 'Coffee',
    note: '',
    createdAt: '2026-10-14T09:00:00.000Z',
    ...patch,
  };
}

export function serverRow(patch: Partial<ServerTransaction> = {}): ServerTransaction {
  const { createdAt, ...local } = localRow();
  return {
    ...local,
    scope: 'personal',
    baseAmountMinor: 1250,
    fx: null,
    source: 'manual',
    reviewStatus: 'confirmed',
    importBatchId: null,
    author: { userId: 'ann', displayName: 'Ann' },
    version: 1,
    revision: 10,
    createdAt,
    updatedAt: createdAt,
    ...patch,
  };
}

export function tombstone(id: string, workspaceId = PERSONAL.id): Tombstone {
  return { id, workspaceId, deletedAt: '2026-10-15T00:00:00.000Z', revision: 20 };
}

export function page(patch: Partial<PullPage> = {}): PullPage {
  return {
    workspaces: [PERSONAL],
    accounts: [],
    categories: [],
    transactions: [],
    conflicts: [],
    cursor: 10,
    hasMore: false,
    epoch: 'epoch-1',
    ...patch,
  };
}

/** A device that has synced `rows` from its personal workspace. */
export function syncedState(...rows: ServerTransaction[]): LocalState {
  const state = emptyLocalState();
  return {
    ...state,
    workspaces: new Map([[PERSONAL.id, PERSONAL]]),
    transactions: new Map(
      rows.map((row) => [
        row.id,
        { id: row.id, workspaceId: row.workspaceId, server: row, local: null },
      ]),
    ),
    meta: {
      ...state.meta,
      cursor: 10,
      lastSyncedAt: '2026-10-14T10:00:00.000Z',
      epoch: 'epoch-1',
    },
  };
}

export function sequentialIds(prefix = 'm'): () => string {
  let next = 0;
  return () => `${prefix}-${++next}`;
}
