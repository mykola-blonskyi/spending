import { describe, expect, it } from 'vitest';
import { templateError, type TemplateFacts } from './rules';

const facts = (overrides: Partial<TemplateFacts>): TemplateFacts => ({
  workspaceId: 'family',
  kind: 'expense',
  accountId: 'acc',
  categoryId: 'cat',
  current: null,
  isCreator: true,
  creatorPersonalWorkspaceId: 'personal',
  account: { workspaceId: 'family', archived: false },
  category: { workspaceId: 'family', kind: 'expense', archived: false },
  ...overrides,
});

describe('templateError', () => {
  it('accepts references of the workspace, or the creator’s own account (BR-3)', () => {
    expect(templateError(facts({}))).toBeNull();
    expect(
      templateError(facts({ account: { workspaceId: 'personal', archived: false } })),
    ).toBeNull();
    expect(templateError(facts({ accountId: null, categoryId: null }))).toBeNull();
  });

  it('lets only the creator pick a personal account; others may keep it', () => {
    const personal = { workspaceId: 'personal', archived: false };
    expect(templateError(facts({ isCreator: false, account: personal }))).toBe('INVALID_ACCOUNT');
    expect(
      templateError(
        facts({
          isCreator: false,
          account: personal,
          current: { accountId: 'acc', categoryId: null },
        }),
      ),
    ).toBeNull();
    expect(templateError(facts({ account: { workspaceId: 'other', archived: false } }))).toBe(
      'INVALID_ACCOUNT',
    );
    expect(templateError(facts({ account: null }))).toBe('INVALID_ACCOUNT');
  });

  it('rejects categories of another workspace or kind (BR-4)', () => {
    expect(templateError(facts({ kind: 'income' }))).toBe('INVALID_CATEGORY');
    expect(
      templateError(
        facts({ category: { workspaceId: 'personal', kind: 'expense', archived: false } }),
      ),
    ).toBe('INVALID_CATEGORY');
    expect(templateError(facts({ category: null }))).toBe('INVALID_CATEGORY');
  });

  it('allows archived references only when already used', () => {
    const archived = {
      account: { workspaceId: 'family', archived: true },
      category: { workspaceId: 'family', kind: 'expense' as const, archived: true },
    };
    expect(templateError(facts({ ...archived }))).toBe('INVALID_ACCOUNT');
    expect(templateError(facts({ ...archived, accountId: null }))).toBe('INVALID_CATEGORY');
    expect(
      templateError(facts({ ...archived, current: { accountId: 'acc', categoryId: 'cat' } })),
    ).toBeNull();
  });
});
