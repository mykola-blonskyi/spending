import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Category, Workspace } from '@data/sync';
import { I18nProvider } from '@i18n/index';
import { AccountsPage } from './accounts-page';
import { CategoriesPage } from './categories-page';

const admin = vi.hoisted(() => ({
  isPending: false,
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));
const local = vi.hoisted(() => ({
  status: 'ready' as 'opening' | 'unavailable' | 'ready',
  accounts: [] as unknown[],
  categories: [] as unknown[],
  workspaces: [] as unknown[],
  balances: new Map<string, { balanceMinor: number; uncounted: number; entries?: number }>(),
  rules: [] as { accountId: string | null }[],
}));

vi.mock('./use-ledger-mutations', () => ({
  useAccountsAdmin: () => admin,
  useCategoriesAdmin: () => admin,
}));
vi.mock('@data/sync', () => {
  const list = (items: unknown[]) => ({ ready: true, items });
  return {
    useLocalDataStatus: () => local.status,
    useAccounts: () => list(local.accounts),
    useCategories: () => list(local.categories),
    useWorkspaces: () => list(local.workspaces),
    useAccountBalances: () => local.balances,
    useOpeningForBalance: () => (_: unknown, target: number, today: string) => ({
      openingBalanceMinor: target - 2500,
      openingOn: today,
    }),
  };
});
vi.mock('@data/recurring', () => ({
  rulesQuery: { queryKey: ['recurring-rules'], queryFn: () => local.rules },
}));
vi.mock('@features/profile', () => ({ useProfile: () => ({ timezone: 'UTC' }) }));

const PERSONAL: Workspace = { id: 'ws-1', kind: 'personal', name: 'Ann', role: 'owner' };
const stamp = { revision: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
const account = (patch: Partial<Account>): Account => ({
  id: 'a-1',
  workspaceId: PERSONAL.id,
  name: 'Cash',
  kind: 'cash',
  currency: 'EUR',
  openingBalanceMinor: 0,
  openingOn: null,
  archivedAt: null,
  ...stamp,
  ...patch,
});
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

function renderPage(page: React.ReactNode, locale: 'en' | 'uk' = 'en') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider locale={locale}>{page}</I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Radix Select opens on pointer events jsdom does not implement.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
  admin.create.mockResolvedValue(true);
  admin.update.mockResolvedValue(true);
  admin.archive.mockResolvedValue(true);
  admin.remove.mockResolvedValue(true);
  local.rules = [];
  local.status = 'ready';
  local.workspaces = [PERSONAL];
  local.balances = new Map();
  local.accounts = [
    account({}),
    account({ id: 'a-2', name: 'Old card', kind: 'card', archivedAt: '2026-02-01T00:00:00Z' }),
  ];
  local.categories = [
    category({}),
    category({ id: 'c-2', name: null, kind: 'income', systemKey: 'salary' }),
    category({ id: 'c-3', name: 'Pets', systemKey: null, archivedAt: '2026-02-01T00:00:00Z' }),
  ];
});

describe('AccountsPage', () => {
  it('lists active accounts and keeps archived ones in their own group', () => {
    renderPage(<AccountsPage />);
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('Archived (1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore Old card' })).toBeInTheDocument();
  });

  it('creates an account from the dialog and closes it', async () => {
    renderPage(<AccountsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    const dialog = screen.getByRole('dialog', { name: 'New account' });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter a name of 1 to 60 characters.')).toBeInTheDocument();
    expect(admin.create).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText('Name'), '  Savings jar ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(admin.create).toHaveBeenCalledWith({
      workspaceId: PERSONAL.id,
      name: 'Savings jar',
      kind: 'bank',
      currency: 'EUR',
      openingBalanceMinor: 0,
      openingOn: null,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the dialog open when the server refuses', async () => {
    admin.update.mockResolvedValue(false);
    renderPage(<AccountsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Cash' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit account' });
    expect(within(dialog).getByText(/currency cannot be changed/i)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(admin.update).toHaveBeenCalledWith('a-1', {
      name: 'Cash',
      kind: 'cash',
      openingBalanceMinor: 0,
      openingOn: null,
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('sets the current balance from what the bank shows', async () => {
    local.balances = new Map([['a-1', { balanceMinor: 2500, uncounted: 0 }]]);
    renderPage(<AccountsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Set current balance of Cash' }));
    const dialog = screen.getByRole('dialog', { name: 'Set the current balance of Cash' });
    const balance = within(dialog).getByLabelText('Balance now, in EUR');
    expect(balance).toHaveValue('25.00');

    await userEvent.clear(balance);
    await userEvent.type(balance, '1750');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Set balance' }));

    expect(admin.update).toHaveBeenCalledWith('a-1', {
      openingBalanceMinor: 172500,
      openingOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('archives only after confirming', async () => {
    renderPage(<AccountsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive Cash' }));
    expect(admin.archive).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(admin.archive).toHaveBeenCalledWith('a-1', true);
  });

  it('deletes an unused account only after confirming, warning about its opening balance', async () => {
    local.accounts = [account({ openingBalanceMinor: 12550, openingOn: '2026-01-01' })];
    local.balances = new Map([['a-1', { balanceMinor: 12550, uncounted: 0, entries: 0 }]]);
    renderPage(<AccountsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete Cash' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete the account Cash?' });
    expect(dialog).toHaveTextContent(
      'There is still €125.50 on this account. This cannot be undone.',
    );
    expect(admin.remove).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(admin.remove).toHaveBeenCalledWith('a-1');
    expect(admin.archive).not.toHaveBeenCalled();
  });

  it('names why an account in use cannot be deleted and offers Archive instead', async () => {
    local.balances = new Map([['a-1', { balanceMinor: 0, uncounted: 0, entries: 12 }]]);
    local.rules = [{ accountId: 'a-1' }, { accountId: 'a-9' }];
    renderPage(<AccountsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete Cash' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Cash is in use' });
    expect(await within(dialog).findByText(/\(12 entries, 1 recurring rule\)/)).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(admin.archive).toHaveBeenCalledWith('a-1', true);
    expect(admin.remove).not.toHaveBeenCalled();
  });

  it('offers Delete on an archived account only while nothing uses it', () => {
    local.accounts = [
      account({ id: 'a-2', name: 'Old card', archivedAt: '2026-02-01T00:00:00Z' }),
      account({ id: 'a-3', name: 'Old loan', archivedAt: '2026-02-01T00:00:00Z' }),
    ];
    local.balances = new Map([['a-3', { balanceMinor: 0, uncounted: 0, entries: 1 }]]);
    renderPage(<AccountsPage />);
    expect(screen.getByRole('button', { name: 'Delete Old card' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Old loan' })).not.toBeInTheDocument();
  });

  it('shows each balance, red when negative, and per-currency totals of active accounts', () => {
    local.accounts = [
      account({}),
      account({ id: 'a-3', name: 'Loan', currency: 'EUR' }),
      account({ id: 'a-4', name: 'Hryvnia', currency: 'UAH' }),
      account({ id: 'a-2', name: 'Old card', archivedAt: '2026-02-01T00:00:00Z' }),
    ];
    local.balances = new Map([
      ['a-1', { balanceMinor: 500000, uncounted: 2 }],
      ['a-3', { balanceMinor: -70000, uncounted: 0 }],
      ['a-4', { balanceMinor: 5200000, uncounted: 0 }],
      ['a-2', { balanceMinor: 99900, uncounted: 0 }],
    ]);
    renderPage(<AccountsPage />);

    const total = screen.getByText('Total').parentElement!;
    expect(total).toHaveTextContent('€4,300.00·UAH 52,000.00');
    expect(screen.getAllByText('-€700.00')[0]!.parentElement).toHaveClass('text-expense');
    expect(
      screen.getByText('2 entries before the opening date are not counted'),
    ).toBeInTheDocument();
    const archive = screen.getByText('Archived (1)').closest('details')!;
    expect(archive).not.toHaveAttribute('open');
    expect(archive).toHaveTextContent('€999.00');
  });

  it('warns before archiving an account that still holds money', async () => {
    local.balances = new Map([['a-1', { balanceMinor: 12550, uncounted: 0 }]]);
    renderPage(<AccountsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive Cash' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'There is still €125.50 on this account.',
    );
  });

  it('asks for the opening date only with a non-zero balance, refusing what is not an amount', async () => {
    renderPage(<AccountsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Cash' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit account' });
    const opening = within(dialog).getByLabelText('Opening balance');
    expect(within(dialog).queryByLabelText('Opening date')).not.toBeInTheDocument();
    await userEvent.type(opening, '0,00');
    expect(within(dialog).queryByLabelText('Opening date')).not.toBeInTheDocument();
    await userEvent.clear(opening);

    await userEvent.type(opening, '12abc');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText(/Enter an amount such as/)).toBeInTheDocument();
    expect(admin.update).not.toHaveBeenCalled();

    await userEvent.clear(opening);
    await userEvent.type(opening, '-250,50');
    fireEvent.change(within(dialog).getByLabelText('Opening date'), {
      target: { value: '2026-03-01' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(admin.update).toHaveBeenCalledWith('a-1', {
      name: 'Cash',
      kind: 'cash',
      openingBalanceMinor: -25050,
      openingOn: '2026-03-01',
    });
  });

  it('offers the family choice only with a family workspace', async () => {
    local.workspaces = [PERSONAL, { id: 'ws-2', kind: 'family', name: 'Home', role: 'member' }];
    renderPage(<AccountsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    expect(screen.getByLabelText('Where it belongs')).toBeInTheDocument();
  });

  it('shows the empty and unavailable states', () => {
    local.accounts = [];
    const { unmount } = renderPage(<AccountsPage />);
    expect(screen.getByText('No accounts yet')).toBeInTheDocument();
    unmount();
    local.status = 'unavailable';
    renderPage(<AccountsPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('disables changes while offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderPage(<AccountsPage />);
    expect(screen.getByRole('button', { name: 'Add account' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Cash' })).toBeDisabled();
    expect(screen.getByText(/You are offline/)).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});

describe('CategoriesPage', () => {
  it('groups by type and localizes defaults', () => {
    renderPage(<CategoriesPage />, 'uk');
    expect(screen.getByRole('heading', { name: 'Витрати' })).toBeInTheDocument();
    expect(screen.getByText('Продукти')).toBeInTheDocument();
    expect(screen.getByText('Зарплата')).toBeInTheDocument();
  });

  it('edits a default with its localized name as the placeholder, and renames or resets it', async () => {
    renderPage(<CategoriesPage />, 'uk');
    await userEvent.click(screen.getByRole('button', { name: 'Змінити: Продукти' }));
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByLabelText('Назва');
    expect(name).toHaveValue('');
    expect(name).toHaveAttribute('placeholder', 'Продукти');
    expect(within(dialog).getByText(/Стандартні категорії показуються/)).toBeInTheDocument();
    await userEvent.type(name, 'Їжа');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Зберегти' }));
    expect(admin.update).toHaveBeenCalledWith('c-1', {
      name: 'Їжа',
      color: '#16a34a',
      icon: 'shopping-basket',
    });

    local.categories = [category({ name: 'Їжа' })];
    renderPage(<CategoriesPage />, 'uk');
    await userEvent.click(screen.getByRole('button', { name: 'Змінити: Їжа' }));
    const reopened = within(screen.getByRole('dialog')).getByLabelText('Назва');
    await userEvent.clear(reopened);
    await userEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    expect(admin.update).toHaveBeenLastCalledWith('c-1', {
      name: null,
      color: '#16a34a',
      icon: 'shopping-basket',
    });
  });

  it('creates a category with the chosen color and icon', async () => {
    renderPage(<CategoriesPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add category' }));
    const dialog = screen.getByRole('dialog', { name: 'New category' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Garden');
    await userEvent.click(within(dialog).getByRole('radio', { name: '#db2777' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'pizza' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(admin.create).toHaveBeenCalledWith({
      workspaceId: PERSONAL.id,
      name: 'Garden',
      kind: 'expense',
      color: '#db2777',
      icon: 'pizza',
    });
  });

  it('refuses a name a category of the same type already shows, and reveals that one', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderPage(<CategoriesPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add category' }));
    const dialog = screen.getByRole('dialog', { name: 'New category' });
    await userEvent.type(within(dialog).getByLabelText('Name'), '  groceries ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(within(dialog).getByText('This category already exists.')).toBeInTheDocument();
    expect(admin.create).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Show it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const row = screen.getByText('Groceries').closest('li');
    expect(row).toHaveAttribute('data-highlighted');
    expect(scrollIntoView.mock.instances[0]).toBe(row);
  });

  it('compares against the localized name of a default', async () => {
    renderPage(<CategoriesPage />, 'uk');
    await userEvent.click(screen.getByRole('button', { name: 'Додати категорію' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Назва'), 'продукти');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Зберегти' }));
    expect(within(dialog).getByText('Така категорія вже є.')).toBeInTheDocument();
    expect(admin.create).not.toHaveBeenCalled();
  });

  it('allows the same name for the other type', async () => {
    renderPage(<CategoriesPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add category' }));
    const dialog = screen.getByRole('dialog', { name: 'New category' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Groceries');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Income' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(admin.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'income' }));
  });

  it('blocks renaming onto another category but allows saving the own name', async () => {
    renderPage(<CategoriesPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Pets' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit category' });
    const name = within(dialog).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'groceries');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('This category already exists.')).toBeInTheDocument();
    expect(admin.update).not.toHaveBeenCalled();

    await userEvent.clear(name);
    await userEvent.type(name, 'Pets');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(admin.update).toHaveBeenCalledWith('c-3', expect.objectContaining({ name: 'Pets' }));
  });

  it('restores an archived category directly', async () => {
    renderPage(<CategoriesPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Restore Pets' }));
    expect(admin.archive).toHaveBeenCalledWith('c-3', false);
  });
});
