import type { Browser, Locator, Page } from '@playwright/test';
import { clientHeaders, expect, signInAs as signInPageAs, test } from './fixtures';
import { APP_ORIGIN, E2E_USERS } from './support/env';

const ann = E2E_USERS.ann;
const REJECTED =
  'Not synced: This category is archived or does not fit this type. Pick another one.';

const badge = (page: Page) =>
  page.getByRole('banner').locator('a[href="/sync"]').getByRole('status');
const row = (page: Page, description: string) =>
  page.getByRole('link', { name: new RegExp(description) });

async function pickCategory(page: Page, name: string) {
  await page.getByRole('radiogroup', { name: 'Category' }).getByRole('radio', { name }).click();
}

async function record(page: Page, amount: string, description: string, category: string) {
  await page.goto('/transactions/new');
  await page.getByLabel('Amount').fill(amount);
  await pickCategory(page, category);
  await page.getByLabel('Description').fill(description);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
}

async function archiveOnAnotherDevice(browser: Browser, category: string) {
  const device = await browser.newContext({
    baseURL: APP_ORIGIN,
    extraHTTPHeaders: clientHeaders(),
  });
  const other = await device.newPage();
  await signInPageAs(other, 'ann');
  await other.goto('/categories');
  await other.getByRole('button', { name: `Archive ${category}` }).click();
  await other.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(other.getByText(/^Archived \(1\)$/)).toBeVisible();
  await device.close();
}

/** Device A goes offline knowing Groceries, which device B then archives. */
async function goOfflineWhileGroceriesIsArchived(page: Page, browser: Browser) {
  await expect(badge(page)).toHaveText('Up to date');
  await page.context().setOffline(true);
  await expect(badge(page)).toHaveText('Working offline');
  await archiveOnAnotherDevice(browser, 'Groceries');
}

async function discard(page: Page, scope: Page | Locator = page) {
  await scope.getByRole('button', { name: 'Discard change' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard change' }).click();
}

test('a change rejected for an archived category is shown as failed, fixed and synced', async ({
  page,
  browser,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await page.goto('/transactions');
  await goOfflineWhileGroceriesIsArchived(page, browser);
  await record(page, '12', 'Market run', 'Groceries');
  await record(page, '3', 'Bus fare', 'Transport');

  await page.context().setOffline(false);
  await expect(row(page, 'Market run')).toContainText(REJECTED);
  await expect.poll(() => db.transactions(ann.email)).toMatchObject([{ description: 'Bus fare' }]);
  await expect(row(page, 'Bus fare')).not.toContainText('Not synced');

  await row(page, 'Market run').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit transaction');
  await pickCategory(page, 'Dining');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');

  await expect(badge(page)).toHaveText('Up to date');
  await expect(row(page, 'Market run')).toContainText('Dining');
  await expect(row(page, 'Market run')).not.toContainText('Not synced');
  await expect
    .poll(async () => (await db.transactions(ann.email)).map((r) => r.description).sort())
    .toEqual(['Bus fare', 'Market run']);
});

test('discarding a rejected change reverts a synced entry and removes a new one', async ({
  page,
  browser,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await record(page, '10', 'Lunch', 'Dining');
  await expect.poll(() => db.transactions(ann.email)).toHaveLength(1);
  await goOfflineWhileGroceriesIsArchived(page, browser);

  await row(page, 'Lunch').click();
  await page.getByLabel('Amount').fill('99');
  await pickCategory(page, 'Groceries');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
  await record(page, '4', 'Snack', 'Groceries');

  await page.context().setOffline(false);
  await expect(row(page, 'Lunch')).toContainText(REJECTED);
  await expect(row(page, 'Snack')).toContainText(REJECTED);

  await row(page, 'Lunch').click();
  await discard(page);
  await expect(page).toHaveURL('/transactions');
  await expect(row(page, 'Lunch')).toContainText('-€10.00');
  await expect(row(page, 'Lunch')).toContainText('Dining');
  await expect(row(page, 'Lunch')).not.toContainText('Not synced');

  await row(page, 'Snack').click();
  await discard(page);
  await expect(row(page, 'Snack')).toHaveCount(0);
  await expect(badge(page)).toHaveText('Up to date');
  await page.reload();
  await expect(row(page, 'Lunch')).toContainText('-€10.00');
  await expect(row(page, 'Snack')).toHaveCount(0);
  expect(await db.transactions(ann.email)).toMatchObject([
    { description: 'Lunch', amount_minor: 1000, version: 1, deleted: false },
  ]);
});

test('the split view discards a rejected new entry from its detail pane', async ({
  page,
  browser,
  signInAs,
  db,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAs('ann');
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Split view' }).click();
  await expect(page.locator('[data-layout]')).toHaveAttribute('data-layout', 'split');
  await page.goto('/transactions');
  await goOfflineWhileGroceriesIsArchived(page, browser);
  await record(page, '4', 'Snack', 'Groceries');

  await page.context().setOffline(false);
  await expect(row(page, 'Snack')).toContainText(REJECTED);
  await row(page, 'Snack').click();
  const detail = page.getByRole('region', { name: 'Selected transaction' });
  await expect(detail.locator('h2').first()).toContainText('Snack');
  await discard(page, detail);

  await expect(row(page, 'Snack')).toHaveCount(0);
  await expect(badge(page)).toHaveText('Up to date');
  expect(await db.transactions(ann.email)).toEqual([]);
});
