import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@data/query-client';
import { fakeLocalData, serverRow, syncedState } from '@data/sync/fixtures';
import { LocalDataContext } from '@data/sync/local-data-context';
import { testSession } from '@data/testing';
import { I18nProvider } from '@i18n/index';
import { account, category, renderTransactionScreen } from './test-helpers';
import { HybridEntry } from './layouts/hybrid-entry';
import { HybridHistory } from './layouts/hybrid-history';
import { SplitEntry } from './layouts/split-entry';
import { SplitHistory } from './layouts/split-history';

vi.mock('@features/auth', () => ({ useSession: () => testSession() }));

const state = {
  ...syncedState(
    serverRow({ id: 'tx-1', categoryId: 'cat-groceries', accountId: 'acc-card' }),
    serverRow({ id: 'tx-2', description: 'Bread', occurredOn: '2026-10-13' }),
    serverRow({ id: 'tx-3', description: 'Rent', occurredOn: '2026-10-12', note: 'October' }),
  ),
  accounts: new Map([['acc-card', account()]]),
  categories: new Map([['cat-groceries', category()]]),
};

function setDesktop(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  setDesktop(false);
  // jsdom lays nothing out; give the virtualized list a viewport so it renders rows.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ width: 400, height: 56 }),
  );
});
afterEach(() => vi.restoreAllMocks());

const at = (path: string, route: string) => ({
  data: fakeLocalData(state).value,
  path,
  route,
});

describe('split and hybrid screens', () => {
  it.each([
    ['split', SplitHistory],
    ['hybrid', HybridHistory],
  ])('%s history lists the entries under a search field', (_name, History) => {
    renderTransactionScreen(<History />, at('/transactions', '/transactions'));
    expect(screen.getByRole('searchbox', { name: 'Search transactions' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Bread/ })).toHaveAttribute(
      'href',
      '/transactions/tx-2',
    );
  });

  it.each([
    ['split', SplitEntry],
    ['hybrid', HybridEntry],
  ])('%s entry opens on the amount', (_name, Entry) => {
    renderTransactionScreen(<Entry />, at('/transactions/new', '/transactions/new'));
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
  });

  it('shows the selected entry full screen on phones, with a way back', () => {
    renderTransactionScreen(<SplitHistory />, at('/transactions/tx-3', '/transactions/:id'));
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rent' })).toBeInTheDocument();
    expect(screen.getByText('October')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to transactions' })).toBeInTheDocument();
  });

  it('keeps the list mounted while selecting entries on desktop', async () => {
    setDesktop(true);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={createQueryClient()}>
        <I18nProvider locale="en">
          <LocalDataContext value={fakeLocalData(state).value}>{children}</LocalDataContext>
        </I18nProvider>
      </QueryClientProvider>
    );
    render(
      <MemoryRouter initialEntries={['/transactions']}>
        <Routes>
          <Route path="/transactions" element={<SplitHistory />} />
          <Route path="/transactions/:id" element={<SplitHistory />} />
        </Routes>
      </MemoryRouter>,
      { wrapper },
    );
    const search = screen.getByRole('searchbox', { name: 'Search transactions' });
    expect(screen.getByText('Pick a transaction')).toBeInTheDocument();
    await userEvent.type(search, 'e');

    await userEvent.click(screen.getByRole('link', { name: /Bread/ }));
    expect(screen.getByRole('heading', { name: 'Bread' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Bread/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('searchbox', { name: 'Search transactions' })).toBe(search);
    expect(search).toHaveValue('e');

    await userEvent.click(screen.getByRole('link', { name: /Rent/ }));
    expect(screen.getByRole('heading', { name: 'Rent' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search transactions' })).toBe(search);
  });
});
