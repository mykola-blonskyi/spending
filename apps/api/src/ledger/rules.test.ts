import { describe, expect, it } from 'vitest';
import { referenceError, type ReferenceFacts, transferError } from './rules';

const FAMILY = 'f0000000-0000-4000-8000-000000000003';
const BOB_PERSONAL = 'b1000000-0000-4000-8000-000000000002';
const CATEGORY = 'ca000000-0000-4000-8000-000000000005';
const input = {
  workspaceId: FAMILY,
  kind: 'expense' as const,
  categoryId: null,
  transferId: null,
  transferOutside: false,
};

const referenceFacts = (overrides: Partial<ReferenceFacts>): ReferenceFacts => ({
  workspaceId: 'family',
  kind: 'expense',
  accountId: 'acc',
  categoryId: 'cat',
  current: null,
  isAuthor: true,
  authorPersonalWorkspaceId: 'personal',
  account: { workspaceId: 'family', archived: false },
  category: { workspaceId: 'family', kind: 'expense', archived: false },
  ...overrides,
});

describe('referenceError', () => {
  it('accepts references of the workspace, or the creator’s own account (BR-3)', () => {
    expect(referenceError(referenceFacts({}))).toBeNull();
    expect(
      referenceError(referenceFacts({ account: { workspaceId: 'personal', archived: false } })),
    ).toBeNull();
    expect(referenceError(referenceFacts({ accountId: null, categoryId: null }))).toBeNull();
  });

  it('lets only the creator pick a personal account; others may keep it', () => {
    const personal = { workspaceId: 'personal', archived: false };
    expect(referenceError(referenceFacts({ isAuthor: false, account: personal }))).toBe(
      'INVALID_ACCOUNT',
    );
    expect(
      referenceError(
        referenceFacts({
          isAuthor: false,
          account: personal,
          current: { accountId: 'acc', categoryId: null },
        }),
      ),
    ).toBeNull();
    expect(
      referenceError(referenceFacts({ account: { workspaceId: 'other', archived: false } })),
    ).toBe('INVALID_ACCOUNT');
    expect(referenceError(referenceFacts({ account: null }))).toBe('INVALID_ACCOUNT');
  });

  it('rejects categories of another workspace or kind (BR-4)', () => {
    expect(referenceError(referenceFacts({ kind: 'income' }))).toBe('INVALID_CATEGORY');
    expect(
      referenceError(
        referenceFacts({ category: { workspaceId: 'personal', kind: 'expense', archived: false } }),
      ),
    ).toBe('INVALID_CATEGORY');
    expect(referenceError(referenceFacts({ category: null }))).toBe('INVALID_CATEGORY');
  });

  it('allows archived references only when already used', () => {
    const archived = {
      account: { workspaceId: 'family', archived: true },
      category: { workspaceId: 'family', kind: 'expense' as const, archived: true },
    };
    expect(referenceError(referenceFacts({ ...archived }))).toBe('INVALID_ACCOUNT');
    expect(referenceError(referenceFacts({ ...archived, accountId: null }))).toBe(
      'INVALID_CATEGORY',
    );
    expect(
      referenceError(
        referenceFacts({ ...archived, current: { accountId: 'acc', categoryId: 'cat' } }),
      ),
    ).toBeNull();
  });
});

describe('transferError', () => {
  const TRANSFER = 'd0000000-0000-4000-8000-000000000007';
  const side = { ...input, transferId: TRANSFER };
  const peer = { workspaceId: FAMILY, kind: 'income' as const, transferOutside: false };

  it('accepts a first side alone, a matching second side and a one-sided transfer', () => {
    expect(transferError(side, [])).toBeNull();
    expect(transferError(side, [peer])).toBeNull();
    expect(transferError({ ...side, transferOutside: true }, [])).toBeNull();
    expect(transferError(input, [])).toBeNull();
  });

  it('refuses a category, another workspace, the same kind, a third side or a lone marker', () => {
    expect(transferError({ ...side, categoryId: CATEGORY }, [])).toBe('INVALID_TRANSFER');
    expect(transferError(side, [{ ...peer, workspaceId: BOB_PERSONAL }])).toBe('INVALID_TRANSFER');
    expect(transferError(side, [{ ...peer, kind: 'expense' }])).toBe('INVALID_TRANSFER');
    expect(transferError(side, [peer, peer])).toBe('INVALID_TRANSFER');
    expect(transferError(side, [{ ...peer, transferOutside: true }])).toBe('INVALID_TRANSFER');
    expect(transferError({ ...side, transferOutside: true }, [peer])).toBe('INVALID_TRANSFER');
    expect(transferError({ ...input, transferOutside: true }, [])).toBe('INVALID_TRANSFER');
  });
});
