import { describe, expect, it } from 'vitest';
import type { Category } from '@data/sync';
import { budgetableCategories } from './budgets';

const category = (patch: Partial<Category>): Category => ({
  id: 'cat',
  workspaceId: 'ws-personal',
  name: 'Category',
  kind: 'expense',
  color: '#000000',
  icon: 'tag',
  systemKey: null,
  archivedAt: null,
  revision: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...patch,
});

describe('budgetableCategories', () => {
  it('offers only unbudgeted, active expense categories of the chosen workspace', () => {
    const categories = [
      category({ id: 'groceries' }),
      category({ id: 'rent' }),
      category({ id: 'salary', kind: 'income' }),
      category({ id: 'old', archivedAt: '2026-09-01T00:00:00.000Z' }),
      category({ id: 'home', workspaceId: 'ws-family' }),
    ];
    const ids = (workspaceId: string, budgeted: string[]) =>
      budgetableCategories(
        categories,
        workspaceId,
        budgeted.map((categoryId) => ({ categoryId })),
      ).map((c) => c.id);

    expect(ids('ws-personal', [])).toEqual(['groceries', 'rent']);
    expect(ids('ws-personal', ['rent'])).toEqual(['groceries']);
    expect(ids('ws-family', [])).toEqual(['home']);
  });
});
