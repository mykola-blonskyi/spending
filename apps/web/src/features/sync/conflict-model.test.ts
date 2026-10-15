import { describe, expect, it } from 'vitest';
import type { Conflict } from '@data/sync';
import { differingFields, mergeVersions, pickSide, versionsOf } from './conflict-model';

const server = {
  id: 'tx-1',
  workspaceId: 'ws-1',
  scope: 'personal',
  kind: 'expense',
  amountMinor: 2000,
  currency: 'EUR',
  baseAmountMinor: 2000,
  fx: null,
  occurredOn: '2026-10-14',
  accountId: null,
  categoryId: 'cat-1',
  description: 'Lunch',
  note: '',
  source: 'manual',
  reviewStatus: 'confirmed',
  importBatchId: null,
  author: { userId: 'ann', displayName: 'Ann' },
  version: 2,
  revision: 10,
  createdAt: '2026-10-14T09:00:00.000Z',
  updatedAt: '2026-10-14T09:00:00.000Z',
} as const;
const { id, workspaceId, kind, amountMinor, occurredOn, accountId, categoryId, note } = server;
const local = {
  id,
  workspaceId,
  kind,
  amountMinor,
  currency: 'USD',
  occurredOn,
  accountId,
  categoryId,
  description: 'Team lunch',
  note,
};

function conflict(patch: Partial<Conflict> = {}): Conflict {
  return {
    id: 'c-1',
    transactionId: 'tx-1',
    baseVersion: 1,
    serverVersion: 2,
    local,
    server,
    createdAt: '2026-10-15T12:00:00.000Z',
    ...patch,
  };
}

describe('conflict review', () => {
  it('lists the fields that differ, amount and currency as one', () => {
    expect(differingFields(versionsOf(conflict()))).toEqual(['amount', 'description']);
  });

  it('compares a deletion as a whole', () => {
    const deleted = versionsOf(conflict({ local: { deleted: true } }));
    expect(deleted.local).toBeNull();
    expect(differingFields(deleted)).toEqual([]);
    const gone = versionsOf(
      conflict({ server: { id, workspaceId, deletedAt: server.updatedAt, revision: 11 } }),
    );
    expect(gone.server).toBeNull();
    expect(differingFields(gone)).toEqual([]);
  });

  it('merges field by field over the server version', () => {
    const versions = versionsOf(conflict());
    const merged = mergeVersions(versions.server!, versions.local!, {
      description: 'local',
      amount: 'server',
    });
    expect(merged).toEqual({ ...versions.server, description: 'Team lunch' });
    expect(mergeVersions(versions.server!, versions.local!, { amount: 'local' })).toMatchObject({
      amountMinor: 2000,
      currency: 'USD',
      description: 'Lunch',
    });
  });

  it('picks a category with its kind and workspace, and an account with its workspace', () => {
    const moved = versionsOf(
      conflict({
        local: {
          ...local,
          kind: 'income',
          workspaceId: 'ws-2',
          categoryId: 'cat-2',
          accountId: 'acc-2',
        },
      }),
    );
    const differing = differingFields(moved);
    expect(pickSide({}, differing, 'kind', 'local')).toEqual({
      kind: 'local',
      categoryId: 'local',
      workspaceId: 'local',
      accountId: 'local',
    });
    const sameKind = differingFields(
      versionsOf(conflict({ local: { ...local, categoryId: 'c' } })),
    );
    expect(pickSide({ amount: 'local' }, sameKind, 'categoryId', 'local')).toEqual({
      amount: 'local',
      categoryId: 'local',
    });
  });
});
