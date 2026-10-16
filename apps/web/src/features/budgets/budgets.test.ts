import { describe, expect, it } from 'vitest';
import { type CategoryView, categoryIcon } from '@features/ledger';
import { budgetableCategories } from './budgets';

const category = (patch: Partial<CategoryView>): CategoryView => ({
  id: 'cat',
  workspaceId: 'ws-personal',
  name: 'Category',
  kind: 'expense',
  color: '#000000',
  Icon: categoryIcon('tag'),
  archived: false,
  ...patch,
});

describe('budgetableCategories', () => {
  it('offers only unbudgeted, active expense categories of the chosen workspace', () => {
    const categories = [
      category({ id: 'groceries' }),
      category({ id: 'rent' }),
      category({ id: 'salary', kind: 'income' }),
      category({ id: 'old', archived: true }),
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
