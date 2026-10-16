import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@data/query-client';
import type { Category, Workspace } from '@data/sync';
import { I18nProvider } from '@i18n/index';
import { BudgetDialog } from './budget-dialog';

const PERSONAL: Workspace = { id: 'ws-1', kind: 'personal', name: null, role: 'owner' };
const stamp = { revision: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
const category = (patch: Partial<Category>): Category => ({
  id: 'c-1',
  workspaceId: PERSONAL.id,
  name: null,
  kind: 'expense',
  color: '#16a34a',
  icon: 'shopping-basket',
  systemKey: 'groceries',
  archivedAt: null,
  ...stamp,
  ...patch,
});
const local = vi.hoisted(() => ({ categories: [] as unknown[] }));

vi.mock('@data/sync', () => ({
  useCategories: () => ({ ready: true, items: local.categories }),
  useWorkspaces: () => ({ ready: true, items: [PERSONAL] }),
}));

describe('BudgetDialog', () => {
  beforeAll(() => {
    // Radix Select opens on pointer events jsdom does not implement.
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.scrollIntoView = () => {};
  });

  it('lists default categories in the active language, renamed ones by their name', async () => {
    local.categories = [
      category({}),
      category({ id: 'c-2', systemKey: 'dining', name: 'Pizza nights' }),
    ];
    render(
      <QueryClientProvider client={createQueryClient()}>
        <I18nProvider locale="uk">
          <BudgetDialog mode={{ kind: 'create', budgets: [] }} trigger={<button>open</button>} />
        </I18nProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Категорія' }));
    const options = within(await screen.findByRole('listbox'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['Pizza nights', 'Продукти']);
  });
});
