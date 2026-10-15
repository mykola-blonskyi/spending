import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@data/query-client';
import {
  type Account,
  type Category,
  type TransactionEntry,
  useAccounts,
  useCategories,
  useLocalTransaction,
} from '@data/sync';
import { FAMILY, PERSONAL, localRow } from '@data/sync/fixtures';
import { testProfile, testSession } from '@data/testing';
import { I18nProvider } from '@i18n/index';
import { EditTransactionPage, NewTransactionPage } from './transaction-pages';

vi.mock('@features/auth', () => ({ useSession: () => testSession() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock(import('@data/sync'), async (importOriginal) => ({
  ...(await importOriginal()),
  useWorkspaces: vi.fn(() => ({ ready: true, items: [PERSONAL, FAMILY] })),
  useAccounts: vi.fn(() => ({ ready: true, items: [] })),
  useCategories: vi.fn(() => ({ ready: true, items: [] })),
  useLocalTransaction: vi.fn(() => ({ ready: true, entry: undefined })),
  useRecordTransaction: () => vi.fn(),
  useUpdateTransaction: () => vi.fn(),
  useDeleteTransaction: () => vi.fn(),
}));

const stamps = {
  revision: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const account = (id: string, workspaceId: string, name: string): Account => ({
  id,
  workspaceId,
  name,
  kind: 'bank',
  currency: 'EUR',
  archivedAt: null,
  ...stamps,
});
const category = (id: string, workspaceId: string, name: string): Category => ({
  id,
  workspaceId,
  name,
  kind: 'expense',
  color: '#000000',
  icon: 'tag',
  systemKey: null,
  archivedAt: null,
  ...stamps,
});
const bob = { userId: '00000000-0000-4000-8000-000000000002', displayName: 'Bob' };

function setup(ui: React.ReactNode, path: string) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/transactions/new" element={ui} />
            <Route path="/transactions/:id" element={ui} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

async function openOptions(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name }));
  return within(await screen.findByRole('listbox'))
    .getAllByRole('option')
    .map((o) => o.textContent);
}

beforeAll(() => {
  // Radix Select opens on pointer events jsdom does not implement.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  vi.mocked(useAccounts).mockReturnValue({
    ready: true,
    items: [
      account('acc-joint', FAMILY.id, 'Joint'),
      account('acc-ann', PERSONAL.id, 'Ann wallet'),
    ],
  });
  vi.mocked(useCategories).mockReturnValue({
    ready: true,
    items: [
      category('cat-home', FAMILY.id, 'Household'),
      category('cat-mine', PERSONAL.id, 'Mine'),
    ],
  });
});

describe('EditTransactionPage', () => {
  const familyEntry = (author: TransactionEntry['author']): TransactionEntry => ({
    ...localRow({ workspaceId: FAMILY.id }),
    scope: 'family',
    author,
    baseAmountMinor: 1250,
    sync: { state: 'synced' },
  });

  it("offers another member's family entry only the family accounts (BR-3)", async () => {
    vi.mocked(useLocalTransaction).mockReturnValue({ ready: true, entry: familyEntry(bob) });
    setup(<EditTransactionPage />, '/transactions/tx-1');
    expect(await openOptions('Account')).toEqual(['No account', 'Joint']);
  });

  it("offers the author's own personal accounts too", async () => {
    const ann = { userId: testProfile.id, displayName: testProfile.displayName };
    vi.mocked(useLocalTransaction).mockReturnValue({ ready: true, entry: familyEntry(ann) });
    setup(<EditTransactionPage />, '/transactions/tx-1');
    expect(await openOptions('Account')).toEqual(['No account', 'Joint', 'Ann wallet']);
  });
});

describe('NewTransactionPage', () => {
  it('keeps what was typed across a scope change and drops only the category', async () => {
    setup(<NewTransactionPage />, '/transactions/new');
    await userEvent.type(await screen.findByLabelText('Amount'), '12.50');
    await userEvent.click(screen.getByRole('combobox', { name: 'Category' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Mine' }));
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('Mine');

    await userEvent.click(screen.getByRole('radio', { name: 'Family' }));
    expect(screen.getByLabelText('Amount')).toHaveValue('12.50');
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('No category');
    expect(await openOptions('Category')).toEqual(['No category', 'Household']);
  });
});
