import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalState } from '@data/sync/model';
import { fakeLocalData, FAMILY, PERSONAL, serverRow, syncedState } from '@data/sync/fixtures';
import { testSession } from '@data/testing';
import { HISTORY_STORAGE_KEY } from './history-view';
import { TRANSACTION_SCREENS } from './layouts/screens';
import { account, category, renderTransactionScreen } from './test-helpers';

vi.mock('@features/auth', () => ({ useSession: () => testSession() }));

const ledger = (patch: Partial<LocalState> = {}): LocalState => ({
  ...syncedState(
    serverRow({
      id: 'out',
      description: 'To savings',
      accountId: 'acc-card',
      transferId: 'tr-1',
      occurredOn: '2026-01-15',
    }),
    serverRow({
      id: 'in',
      kind: 'income',
      description: '',
      accountId: 'acc-savings',
      transferId: 'tr-1',
      occurredOn: '2026-01-15',
    }),
    serverRow({
      id: 'bread',
      description: 'Bread',
      categoryId: 'cat-groceries',
      accountId: 'acc-card',
      occurredOn: '2026-01-10',
    }),
  ),
  accounts: new Map([
    ['acc-card', account()],
    ['acc-savings', account({ id: 'acc-savings', name: 'Savings' })],
  ]),
  categories: new Map([['cat-groceries', category()]]),
  ...patch,
});

function setDesktop(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** jsdom lays nothing out: every element reports this width and one row's height. */
function setWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ width, height: 44 }),
  );
}

beforeEach(() => {
  localStorage.clear();
  setDesktop(true);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  setWidth(1200);
});
afterEach(() => vi.restoreAllMocks());

const rowsChoice = () => screen.queryByRole('radio', { name: 'Rows' });
const table = () => screen.getByRole('table', { name: 'Transactions' });

describe.each(Object.entries(TRANSACTION_SCREENS))(
  'the %s history table',
  (_, { history: History, ...screens }) => {
    // The history stays mounted on an entry's route, as split and hybrid register it.
    const open = (state: LocalState = ledger()) =>
      renderTransactionScreen(<History />, {
        data: fakeLocalData(state).value,
        path: '/transactions',
        route: '/transactions/:id?',
      });

    it('offers the switch only where the list is wide enough for the table', () => {
      setWidth(500);
      const narrow = open();
      expect(rowsChoice()).toBeNull();
      narrow.unmount();
      setWidth(1200);
      open();
      expect(rowsChoice()).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Table' })).not.toBeChecked();
      expect(screen.queryByRole('table')).toBeNull();
    });

    it('keeps the rows on a narrow list while the table stays the stored choice', () => {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ view: 'table' }));
      setWidth(500);
      open();
      expect(screen.getByRole('list', { name: 'Transactions' })).toBeInTheDocument();
      expect(screen.queryByRole('table')).toBeNull();
      expect(JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY)!)).toEqual({ view: 'table' });
    });

    it('shows rows on a phone', () => {
      setDesktop(false);
      setWidth(375);
      open();
      expect(rowsChoice()).toBeNull();
      expect(screen.getByRole('list', { name: 'Transactions' })).toBeInTheDocument();
    });

    it('shows the columns, a transfer as one row, and remembers the choice', async () => {
      const first = open();
      await userEvent.click(screen.getByRole('radio', { name: 'Table' }));
      expect(
        within(table())
          .getAllByRole('columnheader')
          .map((header) => header.textContent),
      ).toEqual(['Date', 'Description', 'Category', 'Account', 'Amount', 'Sync']);
      const rows = within(table()).getAllByRole('row');
      expect(table()).toHaveAttribute('aria-rowcount', '3');
      expect(rows.map((row) => row.getAttribute('aria-rowindex'))).toEqual(['1', '2', '3']);
      const transfer = within(rows[1]!).getAllByRole('cell');
      expect(transfer.map((cell) => cell.textContent)).toEqual([
        'Jan 15, 2026',
        'To savings',
        'Transfer',
        'Card → Savings',
        expect.stringContaining('€12.50'),
        '',
      ]);
      expect(rows[2]).toHaveTextContent('Bread');
      expect(rows[2]).toHaveTextContent('Groceries');

      first.unmount();
      open();
      expect(table()).toBeInTheDocument();
      expect(JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY)!)).toMatchObject({
        view: 'table',
      });
    });

    it('opens what the layout opens for an entry, by click or Enter', async () => {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ view: 'table' }));
      const { location } = open();
      await userEvent.click(within(table()).getByRole('link', { name: 'Bread' }));
      expect(location()).toBe('/transactions/bread');
      if ('detail' in screens)
        expect(screen.getByRole('heading', { name: 'Bread' })).toBeInTheDocument();

      within(table()).getByRole('link', { name: 'To savings' }).focus();
      await userEvent.keyboard('{Enter}');
      expect(location()).toBe('/transactions/out');
    });

    it('sorts by the date and amount headers, and remembers the sort', async () => {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ view: 'table' }));
      const amounts = ledger({
        ...syncedState(
          serverRow({ id: 'small', description: 'Small', amountMinor: 300, baseAmountMinor: 300 }),
          serverRow({
            id: 'big',
            description: 'Big',
            amountMinor: 9000,
            baseAmountMinor: 9000,
            occurredOn: '2026-01-01',
          }),
          serverRow({
            id: 'usd',
            description: 'Unconverted',
            currency: 'USD',
            amountMinor: 99_000,
            baseAmountMinor: null,
            occurredOn: '2026-02-01',
          }),
        ),
      });
      const descriptions = () =>
        within(table())
          .getAllByRole('row')
          .slice(1)
          .map((row) => within(row).getAllByRole('cell')[1]!.textContent);
      const header = (name: string) =>
        within(table())
          .getByRole('button', { name: new RegExp(`^${name}$`, 'i') })
          .closest('[role="columnheader"]');
      const first = open(amounts);
      expect(descriptions()).toEqual(['Small', 'Unconverted', 'Big']);
      expect(header('date')).toHaveAttribute('aria-sort', 'descending');
      expect(header('amount')).not.toHaveAttribute('aria-sort');

      await userEvent.click(screen.getByRole('button', { name: /^amount$/i }));
      expect(descriptions()).toEqual(['Big', 'Small', 'Unconverted']);
      expect(header('amount')).toHaveAttribute('aria-sort', 'descending');
      expect(header('date')).not.toHaveAttribute('aria-sort');

      screen.getByRole('button', { name: /^amount$/i }).focus();
      await userEvent.keyboard('{Enter}');
      expect(descriptions()).toEqual(['Small', 'Big', 'Unconverted']);
      expect(header('amount')).toHaveAttribute('aria-sort', 'ascending');

      first.unmount();
      open(amounts);
      expect(descriptions()).toEqual(['Small', 'Big', 'Unconverted']);
      expect(header('amount')).toHaveAttribute('aria-sort', 'ascending');

      await userEvent.click(screen.getByRole('button', { name: /^date$/i }));
      expect(descriptions()).toEqual(['Small', 'Unconverted', 'Big']);
      expect(header('date')).toHaveAttribute('aria-sort', 'descending');
    });

    it('sorts by the category and account headers', async () => {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ view: 'table' }));
      open();
      const descriptions = () =>
        within(table())
          .getAllByRole('link')
          .map((link) => link.textContent);
      const sortBy = (name: string) =>
        screen.getByRole('button', { name: new RegExp(`^${name}$`, 'i') });
      expect(descriptions()).toEqual(['To savings', 'Bread']);

      await userEvent.click(sortBy('category'));
      expect(descriptions()).toEqual(['Bread', 'To savings']);
      expect(sortBy('category').closest('[role="columnheader"]')).toHaveAttribute(
        'aria-sort',
        'ascending',
      );

      await userEvent.click(sortBy('account'));
      expect(descriptions()).toEqual(['Bread', 'To savings']);
      await userEvent.click(sortBy('account'));
      expect(descriptions()).toEqual(['To savings', 'Bread']);
      expect(sortBy('account').closest('[role="columnheader"]')).toHaveAttribute(
        'aria-sort',
        'descending',
      );
      expect(sortBy('category').closest('[role="columnheader"]')).not.toHaveAttribute('aria-sort');
    });

    it('adds who recorded an entry for a family member', async () => {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ view: 'table' }));
      open(
        ledger({
          ...syncedState(
            serverRow({
              id: 'family',
              description: 'Groceries for all',
              workspaceId: FAMILY.id,
              scope: 'family',
              author: { userId: 'bob', displayName: 'Bob' },
            }),
          ),
          workspaces: new Map([PERSONAL, FAMILY].map((w) => [w.id, w])),
        }),
      );
      expect(within(table()).getByRole('columnheader', { name: 'Who' })).toBeInTheDocument();
      expect(within(table()).getAllByRole('row')[1]).toHaveTextContent('Bob');
    });
  },
);
