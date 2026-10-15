import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serverRow, syncedState } from '@data/sync/fixtures';
import { testSession } from '@data/testing';
import { BentoEntry } from './layouts/bento-entry';
import { BentoHistory } from './layouts/bento-history';
import { JournalEntry } from './layouts/journal-entry';
import { JournalHistory } from './layouts/journal-history';
import { account, category, fakeLocalData, renderTransactionScreen } from './test-helpers';

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

const history = { path: '/transactions', route: '/transactions' };
const entry = { path: '/transactions/new', route: '/transactions/new' };

describe.each([
  ['journal', JournalHistory, JournalEntry],
  ['bento', BentoHistory, BentoEntry],
])('%s screens', (_name, History, Entry) => {
  it('shows the search field and the entry as a link', () => {
    renderTransactionScreen(<History />, { data: fakeLocalData(state).value, ...history });
    expect(screen.getByRole('searchbox', { name: 'Search transactions' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Coffee/ })).toHaveAttribute(
      'href',
      '/transactions/tx-1',
    );
  });

  it('shows the amount input in a new entry', () => {
    renderTransactionScreen(<Entry />, { data: fakeLocalData(state).value, ...entry });
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
  });
});
