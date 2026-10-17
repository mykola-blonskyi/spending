import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAMILY, PERSONAL, serverRow, syncedState } from '@data/sync/fixtures';
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

beforeAll(() => {
  // Radix Select opens on pointer events jsdom does not implement.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

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

const newScreen = (state: LocalState, Entry: ComponentType = CalmEntry) => {
  const data = fakeLocalData(state);
  const { location } = renderTransactionScreen(<Entry />, {
    data: data.value,
    path: '/transactions/new',
    route: '/transactions/new',
  });
  return { data, location };
};

/** A select in most layouts, a chip that opens its options in the journal. */
async function pick(field: string, option: string) {
  const select = screen.queryByRole('combobox', { name: field });
  if (select) {
    await userEvent.click(select);
    await userEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: option }),
    );
    return;
  }
  await userEvent.click(screen.getByRole('button', { name: field }));
  const options = screen.getByRole('radiogroup', { name: field });
  await userEvent.click(within(options).getByRole('radio', { name: option }));
}

const queued = (state: LocalState) =>
  queueOrder(state).map((m) =>
    m.change.type === 'transaction.upsert' ? m.change.transaction : null,
  );

describe('recording a transfer in the entry form (BR-37)', () => {
  it.each(Object.entries(TRANSACTION_SCREENS))(
    'records both sides in the %s layout',
    async (_, { entry: Entry }) => {
      const { data, location } = newScreen(ledger(), Entry);
      await userEvent.click(screen.getByRole('radio', { name: 'Transfer' }));
      expect(screen.queryByRole('radiogroup', { name: 'Category' })).toBeNull();
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '300' } });
      await pick('From account', 'Card · EUR');
      await pick('To account', 'Savings · EUR');
      expect(screen.queryByLabelText(/Received/)).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

      await waitFor(() => expect(location()).toBe('/transactions'));
      const [out, into] = queued(data.current());
      const side = {
        amountMinor: 30_000,
        currency: 'EUR',
        categoryId: null,
        transferOutside: false,
      };
      expect(out).toMatchObject({ ...side, kind: 'expense', accountId: 'acc-card' });
      expect(into).toMatchObject({ ...side, kind: 'income', accountId: 'acc-savings' });
      expect(out?.transferId).toEqual(expect.any(String));
      expect(into?.transferId).toBe(out?.transferId);
    },
  );

  it('asks what arrived when the currencies differ, labelled with its currency', async () => {
    const state = ledger();
    const { data } = newScreen({
      ...state,
      accounts: new Map([
        ...state.accounts,
        ['acc-uah', account({ id: 'acc-uah', name: 'Hryvnia', currency: 'UAH' })],
      ]),
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Transfer' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '100' } });
    await pick('From account', 'Card · EUR');
    await pick('To account', 'Hryvnia · UAH');
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(await screen.findByText('Enter the amount that arrived, such as 12.50.')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Received, UAH'), { target: { value: '4500' } });
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(data.current().mutations.size).toBe(2));
    expect(queued(data.current())).toMatchObject([
      { kind: 'expense', accountId: 'acc-card', amountMinor: 10_000, currency: 'EUR' },
      { kind: 'income', accountId: 'acc-uah', amountMinor: 450_000, currency: 'UAH' },
    ]);
  });

  it('refuses one account on both sides', async () => {
    const { data } = newScreen(ledger());
    await userEvent.click(screen.getByRole('radio', { name: 'Transfer' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '5' } });
    await pick('From account', 'Card · EUR');
    await pick('To account', 'Card · EUR');
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(await screen.findByText('Choose two different accounts.')).toBeVisible();
    expect(data.current().mutations.size).toBe(0);
  });

  it('offers no transfer with fewer than two accounts in the space, and says why', () => {
    newScreen({ ...ledger(), accounts: new Map([['acc-card', account()]]) });
    const option = screen.getByRole('radio', { name: 'Transfer' });
    expect(option).toBeDisabled();
    expect(option).toHaveAccessibleDescription('A transfer needs two accounts in this space.');
  });

  it('falls back to an expense when the chosen space has fewer than two accounts', async () => {
    newScreen({
      ...ledger(),
      workspaces: new Map([PERSONAL, FAMILY].map((w) => [w.id, w])),
      accounts: new Map([
        ['acc-card', account()],
        ['acc-savings', account({ id: 'acc-savings', name: 'Savings' })],
        ['acc-joint', account({ id: 'acc-joint', workspaceId: FAMILY.id, name: 'Joint' })],
      ]),
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Transfer' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Family' }));
    expect(screen.getByRole('radio', { name: 'Expense' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Transfer' })).toBeDisabled();
  });

  it.each(Object.entries(TRANSACTION_SCREENS))(
    'offers no kind switch when editing a side in the %s layout',
    (_, { entry: Entry }) => {
      renderTransactionScreen(<Entry />, {
        data: fakeLocalData(ledger({ ...out, categoryId: null, transferId: 'tr-1' })).value,
        path: '/transactions/out',
        route: '/transactions/:id',
      });
      expect(screen.getByLabelText('Amount')).toHaveValue('300.00');
      for (const kind of ['Expense', 'Income', 'Transfer'])
        expect(screen.queryByRole('radio', { name: kind })).toBeNull();
    },
  );
});
