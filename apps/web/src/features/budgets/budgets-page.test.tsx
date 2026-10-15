import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@data/api-error';
import { api } from '@data/client';
import { createQueryClient } from '@data/query-client';
import { testProfile, testSession } from '@data/testing';
import { I18nProvider } from '@i18n/index';
import type { Budget } from './budgets';
import { BudgetsPage } from './budgets-page';
import { currentMonth, shiftMonth } from './month';

vi.mock('@features/auth', () => ({ useSession: () => testSession() }));
vi.mock('@data/client', () => ({ api: { GET: vi.fn() } }));
const get = vi.mocked(api.GET);

const thisMonth = currentMonth(testProfile.timezone);
const lastMonth = shiftMonth(thisMonth, -1);
const groceries: Budget = {
  id: 'budget-1',
  workspaceId: 'ws-personal',
  scope: 'personal',
  categoryId: 'groceries',
  amountMinor: 10_000,
  month: thisMonth,
  spentMinor: 2_500,
  unconverted: [],
  status: 'ok',
};

function answerByMonth(answer: (month: string) => Promise<unknown>) {
  get.mockImplementation(((path: string, init: { params: { query: { month: string } } }) =>
    path === '/api/v1/budgets' ? answer(init.params.query.month) : new Promise(() => {})) as never);
}

function renderPage() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nProvider locale="en">
        <BudgetsPage />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const row = () => screen.queryByRole('progressbar', { name: 'Uncategorized' });

beforeEach(() => {
  get.mockReset();
});
afterEach(() => {
  onlineManager.setOnline(true);
});

describe('BudgetsPage month switching', () => {
  it('shows the offline state instead of the previous month under the new heading', async () => {
    answerByMonth(async () => ({ data: { budgets: [groceries] } }));
    renderPage();
    expect(await screen.findByRole('progressbar', { name: 'Uncategorized' })).toBeInTheDocument();

    onlineManager.setOnline(false);
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));

    expect(
      await screen.findByRole('heading', { name: 'Budgets need a connection' }),
    ).toBeInTheDocument();
    expect(row()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled();
  });

  it('keeps the month switcher when another month fails, so the user can go back', async () => {
    answerByMonth((month) =>
      month === lastMonth
        ? Promise.reject(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'x' }))
        : Promise.resolve({ data: { budgets: [groceries] } }),
    );
    renderPage();
    expect(await screen.findByRole('progressbar', { name: 'Uncategorized' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toContainElement(screen.getByRole('button', { name: 'Try again' }));
    expect(row()).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByRole('progressbar', { name: 'Uncategorized' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
