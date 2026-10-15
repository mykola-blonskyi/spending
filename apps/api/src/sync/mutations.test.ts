import { describe, expect, it } from 'vitest';
import {
  decideDelete,
  decideUpsert,
  effectiveAccountId,
  type ExistingRow,
  pullWindow,
  pushBodySchema,
  sameIntent,
  type TransactionInput,
  type UpsertFacts,
} from './mutations';

const ANN = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const ANN_PERSONAL = 'a1000000-0000-4000-8000-000000000001';
const BOB_PERSONAL = 'b1000000-0000-4000-8000-000000000002';
const FAMILY = 'f0000000-0000-4000-8000-000000000003';
const ACCOUNT = 'ac000000-0000-4000-8000-000000000004';
const CATEGORY = 'ca000000-0000-4000-8000-000000000005';

const input: TransactionInput = {
  id: 'e0000000-0000-4000-8000-000000000006',
  workspaceId: FAMILY,
  kind: 'expense',
  amountMinor: 1250,
  currency: 'EUR',
  occurredOn: '2026-10-14',
  accountId: null,
  categoryId: null,
  description: 'Bread',
  note: '',
};

const row = (overrides: Partial<ExistingRow> = {}): ExistingRow => ({
  workspaceId: FAMILY,
  kind: 'expense',
  amountMinor: 1250,
  currency: 'EUR',
  occurredOn: '2026-10-14',
  accountId: null,
  categoryId: null,
  description: 'Bread',
  note: '',
  createdBy: ANN,
  version: 3,
  reviewStatus: 'confirmed',
  deletedAt: null,
  ...overrides,
});

const facts = (overrides: Partial<UpsertFacts> = {}): UpsertFacts => ({
  actorId: BOB,
  workspaces: new Set([BOB_PERSONAL, FAMILY]),
  intended: input,
  baseVersion: null,
  existing: null,
  authorPersonalWorkspaceId: BOB_PERSONAL,
  account: null,
  category: null,
  ...overrides,
});

describe('decideUpsert', () => {
  it('inserts a new row into a workspace the actor belongs to', () => {
    expect(decideUpsert(facts())).toEqual({ outcome: 'insert' });
  });

  it('hides workspaces and rows the actor cannot see', () => {
    expect(decideUpsert(facts({ intended: { ...input, workspaceId: ANN_PERSONAL } }))).toEqual({
      outcome: 'rejected',
      code: 'NOT_FOUND',
    });
    expect(
      decideUpsert(facts({ existing: row({ workspaceId: ANN_PERSONAL }), baseVersion: 3 })),
    ).toEqual({ outcome: 'rejected', code: 'NOT_FOUND' });
  });

  it('lets only the author move a row between workspaces', () => {
    const move = { intended: { ...input, workspaceId: BOB_PERSONAL }, baseVersion: 3 };
    expect(decideUpsert(facts({ ...move, existing: row() }))).toEqual({
      outcome: 'rejected',
      code: 'FORBIDDEN',
    });
    expect(decideUpsert(facts({ ...move, existing: row({ createdBy: BOB }) }))).toEqual({
      outcome: 'update',
    });
  });

  it('refuses rows waiting for import review', () => {
    expect(
      decideUpsert(facts({ existing: row({ reviewStatus: 'pending_review' }), baseVersion: 3 })),
    ).toEqual({ outcome: 'rejected', code: 'REVIEW_REQUIRED' });
  });

  it('turns stale or missing base versions into conflicts unless nothing would change', () => {
    const edit = { ...input, amountMinor: 999 };
    expect(decideUpsert(facts({ existing: row(), baseVersion: 2, intended: edit }))).toEqual({
      outcome: 'conflict',
    });
    expect(decideUpsert(facts({ existing: row(), baseVersion: null, intended: edit }))).toEqual({
      outcome: 'conflict',
    });
    expect(decideUpsert(facts({ existing: row(), baseVersion: 2 }))).toEqual({
      outcome: 'unchanged',
    });
    expect(
      decideUpsert(facts({ existing: row({ deletedAt: new Date() }), baseVersion: 2 })),
    ).toEqual({ outcome: 'conflict' });
  });

  it('updates on the current version, and skips writes that change nothing', () => {
    const edit = { ...input, note: 'fresh' };
    expect(decideUpsert(facts({ existing: row(), baseVersion: 3, intended: edit }))).toEqual({
      outcome: 'update',
    });
    expect(decideUpsert(facts({ existing: row(), baseVersion: 3 }))).toEqual({
      outcome: 'unchanged',
    });
    expect(
      decideUpsert(facts({ existing: row({ deletedAt: new Date() }), baseVersion: 3 })),
    ).toEqual({ outcome: 'update' });
  });

  describe('BR-3 accounts', () => {
    const withAccount = { ...input, accountId: ACCOUNT };

    it.each([
      ['the target workspace', FAMILY, 'insert'],
      ["the author's personal workspace", BOB_PERSONAL, 'insert'],
      ["someone else's personal workspace", ANN_PERSONAL, 'rejected'],
    ])('accounts in %s', (_name, workspaceId, outcome) => {
      expect(
        decideUpsert(facts({ intended: withAccount, account: { workspaceId, archived: false } }))
          .outcome,
      ).toBe(outcome);
    });

    it("lets only the author pick an account from the author's personal workspace", () => {
      const annAccount = { workspaceId: ANN_PERSONAL, archived: false };
      const onAnnsRow = {
        existing: row(),
        baseVersion: 3,
        authorPersonalWorkspaceId: ANN_PERSONAL,
        account: annAccount,
      };
      expect(decideUpsert(facts({ ...onAnnsRow, intended: withAccount }))).toEqual({
        outcome: 'rejected',
        code: 'INVALID_ACCOUNT',
      });
      expect(
        decideUpsert(
          facts({
            ...onAnnsRow,
            existing: row({ accountId: ACCOUNT }),
            intended: { ...withAccount, note: 'x' },
          }),
        ),
      ).toEqual({ outcome: 'update' });
    });

    it('rejects unknown accounts and newly chosen archived ones', () => {
      expect(decideUpsert(facts({ intended: withAccount }))).toEqual({
        outcome: 'rejected',
        code: 'INVALID_ACCOUNT',
      });
      const archived = { workspaceId: FAMILY, archived: true };
      expect(decideUpsert(facts({ intended: withAccount, account: archived }))).toEqual({
        outcome: 'rejected',
        code: 'INVALID_ACCOUNT',
      });
      expect(
        decideUpsert(
          facts({
            intended: { ...withAccount, note: 'x' },
            account: archived,
            existing: row({ accountId: ACCOUNT }),
            baseVersion: 3,
          }),
        ),
      ).toEqual({ outcome: 'update' });
    });

    it("keeps the author's hidden account when a viewer sends null back", () => {
      const existing = row({ accountId: ACCOUNT });
      expect(effectiveAccountId(input, existing, true)).toBe(ACCOUNT);
      expect(effectiveAccountId(input, existing, false)).toBeNull();
      expect(effectiveAccountId(withAccount, null, false)).toBe(ACCOUNT);
    });
  });

  describe('BR-4 categories', () => {
    const withCategory = { ...input, categoryId: CATEGORY };
    const category = { workspaceId: FAMILY, kind: 'expense' as const, archived: false };

    it.each([
      ['a category of the workspace and kind', category, 'insert'],
      ['another workspace', { ...category, workspaceId: BOB_PERSONAL }, 'rejected'],
      ['another kind', { ...category, kind: 'income' as const }, 'rejected'],
      ['an archived one', { ...category, archived: true }, 'rejected'],
      ['an unknown one', null, 'rejected'],
    ])('with %s', (_name, fact, outcome) => {
      expect(decideUpsert(facts({ intended: withCategory, category: fact })).outcome).toBe(outcome);
    });

    it('keeps an archived category that was already set', () => {
      expect(
        decideUpsert(
          facts({
            intended: { ...withCategory, note: 'x' },
            category: { ...category, archived: true },
            existing: row({ categoryId: CATEGORY }),
            baseVersion: 3,
          }),
        ),
      ).toEqual({ outcome: 'update' });
    });
  });
});

describe('decideDelete', () => {
  const workspaces = new Set([BOB_PERSONAL, FAMILY]);

  it.each([
    ['a missing row', null, 3, { outcome: 'rejected', code: 'NOT_FOUND' }],
    [
      'an invisible row',
      row({ workspaceId: ANN_PERSONAL }),
      3,
      { outcome: 'rejected', code: 'NOT_FOUND' },
    ],
    ['a tombstone', row({ deletedAt: new Date() }), 1, { outcome: 'unchanged' }],
    [
      'a pending row',
      row({ reviewStatus: 'pending_review' }),
      3,
      { outcome: 'rejected', code: 'REVIEW_REQUIRED' },
    ],
    ['a stale base', row(), 2, { outcome: 'conflict' }],
    ['the current version', row(), 3, { outcome: 'delete' }],
  ] as const)('handles %s', (_name, existing, baseVersion, expected) => {
    expect(decideDelete({ workspaces, existing, baseVersion })).toEqual(expected);
  });
});

describe('sameIntent', () => {
  it('compares every user-visible field', () => {
    expect(sameIntent(input, row())).toBe(true);
    for (const key of ['amountMinor', 'description', 'note', 'occurredOn'] as const) {
      const changed = { ...input, [key]: key === 'amountMinor' ? 1 : '2026-01-01' };
      expect(sameIntent(changed, row()), key).toBe(false);
    }
  });
});

describe('pullWindow', () => {
  it('returns everything when no table overflows', () => {
    expect(pullWindow(10, 3, [[11, 14], [12], []])).toEqual({ cutoff: 14, hasMore: false });
    expect(pullWindow(10, 3, [[], [], []])).toEqual({ cutoff: 10, hasMore: false });
  });

  it('stops at the smallest last-in-limit revision of overflowing tables', () => {
    expect(
      pullWindow(0, 2, [
        [1, 5, 9],
        [2, 3, 4],
        [6, 7],
      ]),
    ).toEqual({ cutoff: 3, hasMore: true });
  });

  it('lets the tombstone source alone stop or end the page', () => {
    expect(pullWindow(0, 2, [[1], [], [3], [2, 4, 5]])).toEqual({ cutoff: 4, hasMore: true });
    expect(pullWindow(0, 2, [[1], [], [3], [2, 8]])).toEqual({ cutoff: 8, hasMore: false });
  });
});

describe('pushBodySchema', () => {
  const upsert = {
    mutationId: 'd0000000-0000-4000-8000-000000000007',
    type: 'transaction.upsert',
    baseVersion: null,
    transaction: input,
  };

  it('accepts upserts and deletes', () => {
    expect(
      pushBodySchema.safeParse({
        mutations: [
          upsert,
          {
            mutationId: upsert.mutationId,
            type: 'transaction.delete',
            transactionId: input.id,
            baseVersion: 1,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it.each([
    ['an empty batch', []],
    ['an impossible date', [{ ...upsert, transaction: { ...input, occurredOn: '2026-02-30' } }]],
    ['a date out of range', [{ ...upsert, transaction: { ...input, occurredOn: '1969-12-31' } }]],
    ['a zero amount', [{ ...upsert, transaction: { ...input, amountMinor: 0 } }]],
    ['an unsafe amount', [{ ...upsert, transaction: { ...input, amountMinor: 2 ** 53 } }]],
    ['an unknown currency', [{ ...upsert, transaction: { ...input, currency: 'XYZ' } }]],
    [
      'a long description',
      [{ ...upsert, transaction: { ...input, description: 'x'.repeat(201) } }],
    ],
    ['a client-set author', [{ ...upsert, transaction: { ...input, createdBy: 'x' } }]],
    ['too many mutations', Array.from({ length: 201 }, () => upsert)],
  ])('rejects %s', (_name, mutations) => {
    expect(pushBodySchema.safeParse({ mutations }).success).toBe(false);
  });
});
