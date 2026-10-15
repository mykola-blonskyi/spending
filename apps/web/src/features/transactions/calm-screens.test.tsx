import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverRow, syncedState } from '@data/sync/fixtures';
import { queueOrder } from '@data/sync/model';
import { testSession } from '@data/testing';
import { account, category, fakeLocalData, renderTransactionScreen } from './test-helpers';
import { CalmEntry } from './layouts/calm-entry';
import { CalmHistory } from './layouts/calm-history';

vi.mock('@features/auth', () => ({ useSession: () => testSession() }));

const state = {
  ...syncedState(serverRow({ categoryId: 'cat-groceries', accountId: 'acc-card' })),
  accounts: new Map([['acc-card', account()]]),
  categories: new Map([['cat-groceries', category()]]),
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

describe('calm screens', () => {
  it('records an entry from the labelled controls', async () => {
    const data = fakeLocalData(state);
    const { location } = renderTransactionScreen(<CalmEntry />, {
      data: data.value,
      path: '/transactions/new',
      route: '/transactions/new',
    });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '12.34' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Beans' } });
    const picker = screen.getByRole('radiogroup', { name: 'Category' });
    await userEvent.click(within(picker).getByRole('radio', { name: 'Groceries' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(location()).toBe('/transactions'));
    expect(queueOrder(data.current())[0]?.change).toMatchObject({
      transaction: { amountMinor: 1234, description: 'Beans', categoryId: 'cat-groceries' },
    });
  });

  it('lists entries as links under their day', () => {
    renderTransactionScreen(<CalmHistory />, {
      data: fakeLocalData(state).value,
      path: '/transactions',
      route: '/transactions',
    });
    const row = screen.getByRole('link', { name: /Coffee/ });
    expect(row).toHaveAttribute('href', '/transactions/tx-1');
    expect(row).toHaveTextContent('Groceries · Card');
    expect(row).toHaveTextContent('-€12.50');
  });
});
