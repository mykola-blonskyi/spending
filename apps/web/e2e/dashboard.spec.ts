import type { Locator, Page } from '@playwright/test';
import { apiCall, expect, test } from './fixtures';
import { pushEntries } from './support/seed';

const barFill = (page: Page) =>
  page
    .getByRole('region', { name: 'Trend' })
    .locator('rect.fill-income')
    .first()
    .evaluate((rect) => getComputedStyle(rect).fill);

const text = (locator: Locator) => locator.evaluate((element) => element.textContent);

test('seeded entries add up on the overview, compared with the month before', async ({
  page,
  signInAs,
  db,
}) => {
  await db.insertFxRate({ date: '2026-09-04', currency: 'USD', ratePerEur: '1.25', source: 'ecb' });
  await signInAs('ann');
  await pushEntries(page, [
    {
      kind: 'income',
      amountMinor: 300_000,
      occurredOn: '2026-09-01',
      category: 'Salary',
      description: 'Pay',
    },
    { amountMinor: 5_000, occurredOn: '2026-09-02', category: 'Groceries', description: 'Market' },
    {
      amountMinor: 2_500,
      currency: 'USD',
      occurredOn: '2026-09-05',
      category: 'Groceries',
      description: 'Deli',
    },
    { amountMinor: 90_000, currency: 'ARS', occurredOn: '2026-09-03', description: 'Asado' },
    {
      amountMinor: 3_000,
      occurredOn: '2026-08-15',
      category: 'Groceries',
      description: 'August shop',
    },
  ]);
  const pull = await apiCall<{
    workspaces: { id: string; kind: string }[];
    categories: { id: string; name: string; workspaceId: string }[];
  }>(page, 'GET', '/api/v1/sync/pull?cursor=0&limit=1000');
  const personal = pull.workspaces.find((w) => w.kind === 'personal')!;
  const groceries = pull.categories.find(
    (c) => c.name === 'Groceries' && c.workspaceId === personal.id,
  )!;
  await apiCall(page, 'PUT', '/api/v1/budgets', {
    workspaceId: personal.id,
    categoryId: groceries.id,
    amountMinor: 10_000,
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Groceries' })).toHaveAttribute(
    'aria-valuetext',
    '€0.00 of €100.00',
  );

  await page.getByRole('radio', { name: 'Custom' }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-09-01');
  await page.getByLabel('To', { exact: true }).fill('2026-09-30');

  const totals = page.getByRole('region', { name: 'Totals' });
  await expect(totals).toContainText('Compared with Aug 1, 2026 – Aug 31, 2026');
  const tile = (name: string) =>
    totals.locator('div').filter({ has: page.getByText(name, { exact: true }) });
  await expect(tile('Income')).toContainText('€3,000.00');
  await expect(tile('Income')).toContainText('+€3,000.00 vs previous period');
  await expect(tile('Expenses')).toContainText('€70.00');
  await expect(tile('Expenses')).toContainText('+€40.00 vs previous period');
  await expect(tile('Balance')).toContainText('€2,930.00');
  await expect(tile('Balance')).toContainText('+€2,960.00 vs previous period');

  const groceriesRow = page
    .getByRole('region', { name: 'By category' })
    .getByRole('listitem')
    .filter({ hasText: 'Groceries' });
  await expect(groceriesRow).toContainText('€70.00');
  await expect(groceriesRow).toContainText('100% of the total');
  await expect(groceriesRow).toContainText('+€40.00 vs previous period');
  await expect(page.getByRole('region', { name: 'Not converted' })).toContainText(
    'Spent ARS 900.00',
  );

  const trend = page.getByRole('region', { name: 'Trend' });
  await expect(trend.getByRole('img')).toHaveAccessibleName(
    'Income and expenses over time. The highest bar is €3,000.00.',
  );
  await trend.getByText('Show as a table').click();
  const row = trend.getByRole('row', { name: /Sep 2, 2026/ });
  expect(await text(row)).toContain('€50.00');

  const light = await barFill(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => barFill(page)).not.toBe(light);
  expect(light).not.toBe('');
});
