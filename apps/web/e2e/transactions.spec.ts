import { expect, test } from './fixtures';
import { E2E_USERS } from './support/env';

const ann = E2E_USERS.ann;

test('an expense recorded through the queue reaches the server, then edits and deletes follow', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  const badge = page.getByRole('banner').getByRole('status');
  await expect(badge).toHaveText('Up to date');

  let releasePush!: () => void;
  const pushHeld = new Promise<void>((resolve) => (releasePush = resolve));
  await page.route('**/api/v1/sync/push', async (route) => {
    await pushHeld;
    await route.continue();
  });

  await page.goto('/transactions/new');
  await page.getByLabel('Amount').fill('12.34');
  await page.getByLabel('Description').fill('Coffee beans');
  await page.getByRole('combobox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'Groceries' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL('/transactions');
  const row = page.getByRole('link', { name: /Coffee beans/ });
  await expect(row).toContainText('Waiting to sync');
  await expect(row).toContainText('-€12.34');
  await expect(badge).toHaveText(/1 pending|Syncing/);

  releasePush();
  await expect(row).not.toContainText('Waiting to sync');
  await expect(badge).toHaveText('Up to date');
  await page.unroute('**/api/v1/sync/push');
  expect(await db.transactions(ann.email)).toMatchObject([
    { amount_minor: 1234, description: 'Coffee beans', version: 1, deleted: false },
  ]);

  await page.reload();
  await expect(page.getByRole('link', { name: /Coffee beans/ })).toContainText('Groceries');

  await page.getByRole('link', { name: /Coffee beans/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit transaction');
  await page.getByLabel('Amount').fill('20');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('link', { name: /Coffee beans/ })).toContainText('-€20.00');
  await expect(badge).toHaveText('Up to date');
  await expect
    .poll(() => db.transactions(ann.email))
    .toMatchObject([{ amount_minor: 2000, version: 2, deleted: false }]);

  await page.getByRole('link', { name: /Coffee beans/ }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL('/transactions');
  await expect(page.getByRole('link', { name: /Coffee beans/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No transactions yet' })).toBeVisible();
  await expect.poll(() => db.transactions(ann.email)).toMatchObject([{ deleted: true }]);
});

test("a fresh device pulls the user's history from the server", async ({ page, signInAs, db }) => {
  await signInAs('ann');
  await page.goto('/transactions/new');
  await page.getByLabel('Amount').fill('7');
  await page.getByLabel('Description').fill('Bus ticket');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Up to date');
  await expect.poll(() => db.transactions(ann.email)).toHaveLength(1);

  await page.evaluate(async () => {
    for (const { name } of await indexedDB.databases()) if (name) indexedDB.deleteDatabase(name);
  });
  await page.reload();
  await page.goto('/transactions');
  await expect(page.getByRole('link', { name: /Bus ticket/ })).toContainText('-€7.00');
});
