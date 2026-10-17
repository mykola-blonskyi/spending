import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverRow, syncedState } from '@data/sync/fixtures';
import { type LocalState, queueOrder } from '@data/sync/model';
import { testSession } from '@data/testing';
import { CalmEntry } from './layouts/calm-entry';
import { CalmHistory } from './layouts/calm-history';
import { TRANSACTION_SCREENS } from './layouts/screens';
import { account, category, fakeLocalData, renderTransactionScreen } from './test-helpers';

vi.mock('@features/auth', () => ({ useSession: () => testSession() }));

const out = serverRow({
  id: 'out',
  description: 'To savings',
  accountId: 'acc-card',
  categoryId: 'cat-groceries',
  amountMinor: 30_000,
});
const into = serverRow({
  id: 'in',
  kind: 'income',
  description: 'From card',
  accountId: 'acc-savings',
  amountMinor: 30_000,
});
const ledger = (...rows: ReturnType<typeof serverRow>[]): LocalState => ({
  ...syncedState(...rows),
  accounts: new Map([
    ['acc-card', account()],
    ['acc-savings', account({ id: 'acc-savings', name: 'Savings' })],
  ]),
  categories: new Map([['cat-groceries', category()]]),
});

const sent = (state: LocalState) =>
  queueOrder(state).map((m) =>
    m.change.type === 'transaction.upsert'
      ? [m.transactionId, m.change.transaction.transferId, m.change.transaction.categoryId]
      : [],
  );

const editScreen = (state: LocalState, id: string) => {
  const data = fakeLocalData(state);
  renderTransactionScreen(<CalmEntry />, {
    data: data.value,
    path: `/transactions/${id}`,
    route: '/transactions/:id',
  });
  return data;
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

describe('the transfer action (BR-37)', () => {
  it('links an entry to its other side on another account', async () => {
    const data = editScreen(ledger(out, into), 'out');
    await userEvent.click(screen.getByRole('button', { name: 'This is a transfer' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark as a transfer' });
    const other = within(dialog).getByRole('radio', { name: /From card/ });
    expect(other).toBeChecked();
    expect(
      within(dialog).getByRole('radio', { name: /Own account outside the app/ }),
    ).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as transfer' }));

    await waitFor(() => expect(data.current().mutations.size).toBe(2));
    const [first, second] = sent(data.current());
    expect(first).toEqual(['out', expect.any(String), null]);
    expect(second).toEqual(['in', first![1], null]);
    expect(await screen.findByText('A transfer has no category.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Not a transfer' })).toBeVisible();
  });

  it('marks a one-sided transfer to an own account outside the app', async () => {
    const data = editScreen(ledger(out), 'out');
    await userEvent.click(screen.getByRole('button', { name: 'This is a transfer' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/No matching entry/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as transfer' }));

    await waitFor(() => expect(sent(data.current())).toEqual([['out', expect.any(String), null]]));
    const [mutation] = queueOrder(data.current());
    expect(mutation?.change).toMatchObject({ transaction: { transferOutside: true } });
  });

  it('turns both sides back into entries awaiting a category', async () => {
    const linked = ledger(
      { ...out, categoryId: null, transferId: 'tr-1' },
      { ...into, transferId: 'tr-1' },
    );
    const data = editScreen(linked, 'in');
    await userEvent.click(screen.getByRole('button', { name: 'Not a transfer' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Not a transfer?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Not a transfer' }));

    await waitFor(() =>
      expect(sent(data.current())).toEqual([
        ['out', null, null],
        ['in', null, null],
      ]),
    );
    expect(await screen.findByRole('radiogroup', { name: 'Category' })).toBeVisible();
  });

  it('deletes both sides after one confirmation', async () => {
    const data = editScreen(
      ledger({ ...out, categoryId: null, transferId: 'tr-1' }, { ...into, transferId: 'tr-1' }),
      'in',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete this transfer?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(queueOrder(data.current()).map((m) => [m.transactionId, m.change.type])).toEqual([
        ['out', 'transaction.delete'],
        ['in', 'transaction.delete'],
      ]),
    );
  });

  it('shows a transfer in history as one row and leaves it out of the totals', () => {
    renderTransactionScreen(<CalmHistory />, {
      data: fakeLocalData(
        ledger(
          { ...out, description: '', categoryId: null, transferId: 'tr-1' },
          { ...into, description: '', transferId: 'tr-1' },
          serverRow({ id: 'coffee', amountMinor: 250 }),
        ),
      ).value,
      path: '/transactions',
      route: '/transactions',
    });
    const row = screen.getByRole('link', { name: /Card → Savings/ });
    expect(row).toHaveTextContent('Transfer');
    expect(row).toHaveTextContent('€300.00');
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText('Spent').nextSibling).toHaveTextContent('€2.50');
  });

  it.each(Object.entries(TRANSACTION_SCREENS))(
    'shows a transfer as one row in the %s layout',
    (_, { history: History }) => {
      renderTransactionScreen(<History />, {
        data: fakeLocalData(
          ledger(
            { ...out, categoryId: null, transferId: 'tr-1' },
            { ...into, transferId: 'tr-1', amountMinor: 29_900 },
          ),
        ).value,
        path: '/transactions',
        route: '/transactions',
      });
      const row = screen.getByRole('link', { name: /Card → Savings/ });
      expect(row).toHaveTextContent('€300.00');
      expect(row).toHaveTextContent('→ €299.00');
      expect(screen.queryByRole('link', { name: /From card/ })).toBeNull();
    },
  );
});
