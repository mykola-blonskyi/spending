import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeLocalData, serverRow, syncedState } from '@data/sync/fixtures';
import { testSession } from '@data/testing';
import { account, category, renderTransactionScreen } from './test-helpers';
import { CardsEntry } from './layouts/cards-entry';
import { CardsHistory } from './layouts/cards-history';
import { PlayfulEntry } from './layouts/playful-entry';
import { PlayfulHistory } from './layouts/playful-history';
import { SoftEntry } from './layouts/soft-entry';
import { SoftHistory } from './layouts/soft-history';

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

describe.each([
  ['cards', CardsHistory, CardsEntry],
  ['soft', SoftHistory, SoftEntry],
  ['playful', PlayfulHistory, PlayfulEntry],
])('%s screens', (_name, History, Entry) => {
  it('renders history with search and the entry link', () => {
    renderTransactionScreen(<History />, {
      data: fakeLocalData(state).value,
      path: '/transactions',
      route: '/transactions',
    });
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Coffee/ })).toHaveAttribute(
      'href',
      '/transactions/tx-1',
    );
  });

  it('renders a new entry with the amount input', () => {
    renderTransactionScreen(<Entry />, {
      data: fakeLocalData(state).value,
      path: '/transactions/new',
      route: '/transactions/new',
    });
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
