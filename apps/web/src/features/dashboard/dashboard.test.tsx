import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@data/client';
import { createQueryClient } from '@data/query-client';
import { useWorkspaces } from '@data/sync';
import { FAMILY, PERSONAL } from '@data/sync/fixtures';
import { testProfile, testSession } from '@data/testing';
import { I18nProvider } from '@i18n/index';
import { formatMonth, todayIn } from '@shared/format';
import { type Summary, periodContaining, shiftPeriod } from './dashboard-model';
import { DASHBOARD_SCREENS } from './layouts/screens';

vi.mock('@features/auth', () => ({ useSession: () => testSession() }));
vi.mock('@data/client', () => ({ api: { GET: vi.fn() } }));
vi.mock(import('@data/sync'), async (importOriginal) => ({
  ...(await importOriginal()),
  useWorkspaces: vi.fn(() => ({ ready: true, items: [PERSONAL] })),
  useCategories: vi.fn(() => ({ ready: true, items: [] })),
}));
const get = vi.mocked(api.GET);

const month = periodContaining('month', todayIn(testProfile.timezone));

const summary: Summary = {
  period: { from: month.from, to: month.to },
  granularity: 'day',
  totals: { incomeMinor: 300_000, expenseMinor: 12_000, balanceMinor: 288_000 },
  unconverted: [{ currency: 'ARS', incomeMinor: 0, expenseMinor: 90_000 }],
  byCategory: [
    {
      categoryId: '00000000-0000-4000-8000-0000000000a1',
      name: 'Groceries',
      systemKey: null,
      kind: 'expense',
      color: '#16a34a',
      amountMinor: 12_000,
      share: 1,
    },
  ],
  series: [
    { bucket: month.from, incomeMinor: 300_000, expenseMinor: 0 },
    { bucket: month.to, incomeMinor: 0, expenseMinor: 12_000 },
  ],
  previous: {
    period: shiftPeriod(month, -1),
    totals: { incomeMinor: 0, expenseMinor: 3_000, balanceMinor: -3_000 },
    byCategory: [
      {
        categoryId: '00000000-0000-4000-8000-0000000000a1',
        name: 'Groceries',
        systemKey: null,
        kind: 'expense',
        color: '#16a34a',
        amountMinor: 3_000,
        share: 1,
      },
    ],
    deltas: { incomeMinor: 300_000, expenseMinor: 9_000, balanceMinor: 291_000 },
  },
};

type Query = { from: string; to: string; scope: string };
const analyticsCalls = () =>
  (get.mock.calls as unknown as [string, { params: { query: Query } }][])
    .filter(([path]) => path === '/api/v1/analytics/summary')
    .map(([, init]) => init.params.query);

function renderScreen(Screen = DASHBOARD_SCREENS.calm) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nProvider locale="en">
        <MemoryRouter>
          <Screen />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((async (path: string) =>
    path === '/api/v1/analytics/summary' ? { data: summary } : { data: { budgets: [] } }) as never);
});

describe('dashboard', () => {
  it('shows totals with their change, categories, unconverted amounts and the trend as a table', async () => {
    renderScreen();
    const totals = await screen.findByRole('region', { name: 'Totals' });
    expect(totals).toHaveTextContent('Income€3,000.00€3,000.00+€3,000.00 vs previous period');
    expect(totals).toHaveTextContent('Expenses€120.00€120.00+€90.00 vs previous period');
    expect(totals).toHaveTextContent('Balance€2,880.00€2,880.00+€2,910.00 vs previous period');
    expect(totals).toHaveTextContent(
      `Compared with ${formatMonth(shiftPeriod(month, -1).from, 'en')}`,
    );

    const categories = screen.getByRole('region', { name: 'By category' });
    expect(within(categories).getByRole('listitem')).toHaveTextContent(
      'Groceries€120.00€120.00100% of the total+€90.00 vs previous period',
    );
    expect(screen.getByRole('region', { name: 'Not converted' })).toHaveTextContent(
      'ARSSpent ARS 900.00',
    );

    const trend = screen.getByRole('region', { name: 'Trend' });
    expect(within(trend).getByRole('img')).toHaveAccessibleName(
      'Income and expenses over time. The highest bar is €3,000.00.',
    );
    const rows = within(trend).getAllByRole('row', { hidden: true });
    expect(rows.map((row) => row.textContent)).toEqual([
      'PeriodIncomeExpenses',
      expect.stringMatching(/€3,000\.00€3,000\.00€0\.00€0\.00$/),
      expect.stringMatching(/€0\.00€0\.00€120\.00€120\.00$/),
    ]);
    expect(analyticsCalls()).toEqual([{ ...summary.period, scope: 'all', compare: 'previous' }]);
  });

  it('shows no change against a previous period with nothing in it', async () => {
    get.mockImplementation((async (path: string) =>
      path === '/api/v1/analytics/summary'
        ? {
            data: {
              ...summary,
              previous: {
                ...summary.previous!,
                totals: { incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
                byCategory: [],
                deltas: summary.totals,
              },
            },
          }
        : { data: { budgets: [] } }) as never);
    renderScreen();
    const totals = await screen.findByRole('region', { name: 'Totals' });
    expect(totals).toHaveTextContent('Income€3,000.00');
    expect(totals).not.toHaveTextContent(/vs previous period|Compared with/);
    expect(screen.getByRole('region', { name: 'By category' })).not.toHaveTextContent(
      'vs previous period',
    );
  });

  it('asks for the quarter, steps back and refuses a reversed custom range', async () => {
    renderScreen();
    await screen.findByRole('region', { name: 'Totals' });
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: 'Quarter' }));
    const quarter = periodContaining('quarter', month.from);
    expect(analyticsCalls().at(-1)).toMatchObject({ from: quarter.from, to: quarter.to });

    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    const before = shiftPeriod(quarter, -1);
    expect(analyticsCalls().at(-1)).toMatchObject({ from: before.from, to: before.to });

    await userEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    const calls = analyticsCalls().length;
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2000-01-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('The end date is before the start date.');
    expect(analyticsCalls()).toHaveLength(calls);
    expect(screen.queryByRole('region', { name: 'Totals' })).not.toBeInTheDocument();
  });

  it('offers personal, family and combined views only to family members', async () => {
    renderScreen();
    await screen.findByRole('region', { name: 'Totals' });
    expect(screen.queryByRole('group', { name: 'Whose money' })).not.toBeInTheDocument();

    vi.mocked(useWorkspaces).mockReturnValue({ ready: true, items: [PERSONAL, FAMILY] });
    renderScreen();
    await userEvent.click(await screen.findByRole('radio', { name: 'Family' }));
    expect(analyticsCalls().at(-1)).toMatchObject({ scope: 'family' });
  });

  it.each(Object.entries(DASHBOARD_SCREENS))('%s layout shows the figures', async (_, Screen) => {
    renderScreen(Screen);
    expect(await screen.findByRole('region', { name: 'Totals' })).toHaveTextContent('€2,880.00');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Overview');
  });
});
