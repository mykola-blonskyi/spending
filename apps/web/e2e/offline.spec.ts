import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_USERS } from './support/env';

const ann = E2E_USERS.ann;
const badge = (page: Page) =>
  page.getByRole('banner').locator('a[href="/sync"]').getByRole('status');

async function record(page: Page, amount: string, description: string, currency?: string) {
  await page.goto('/transactions/new');
  await page.getByLabel('Amount').fill(amount);
  await page.getByLabel('Description').fill(description);
  if (currency) {
    await page.getByRole('combobox', { name: 'Currency' }).click();
    await page.getByRole('option', { name: currency }).click();
  }
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
}

async function edit(page: Page, description: string) {
  await page.getByRole('link', { name: new RegExp(description) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit transaction');
}

test('works offline through a reload and syncs exactly the intended rows on reconnect', async ({
  page,
  context,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await record(page, '10', 'Keep me');
  await record(page, '11', 'Remove me');
  await expect(badge(page)).toHaveText('Up to date');
  await expect.poll(() => db.transactions(ann.email)).toHaveLength(2);

  await context.setOffline(true);
  await expect(badge(page)).toHaveText('Working offline');
  await record(page, '5', 'Made offline', 'USD');

  await edit(page, 'Keep me');
  await page.getByLabel('Amount').fill('20');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
  await edit(page, 'Remove me');
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL('/transactions');

  // The delete is written after the page returns to history; wait for it before reloading.
  await expect(badge(page)).toHaveText('Working offline, 3 pending');
  await page.reload();
  await expect(badge(page)).toHaveText('Working offline, 3 pending');
  await expect(page.getByRole('link', { name: /Keep me/ })).toContainText('-€20.00');
  await expect(page.getByRole('link', { name: /Made offline/ })).toContainText(
    'Conversion pending',
  );
  await expect(page.getByRole('link', { name: /Remove me/ })).toHaveCount(0);

  await page.getByRole('banner').locator('a[href="/sync"]').click();
  const waiting = page.getByRole('region', { name: '3 changes waiting to sync' });
  await expect(waiting.getByRole('link', { name: /Keep me/ })).toContainText('Waiting to sync');
  await expect(waiting.getByRole('link', { name: /Made offline/ })).toBeVisible();
  await expect(page.getByText('Everything is in sync')).toHaveCount(0);

  await context.setOffline(false);
  await expect(page.getByText('Everything is in sync')).toBeVisible();
  await expect(badge(page)).toHaveText('Up to date');
  await expect
    .poll(async () =>
      (await db.transactions(ann.email))
        .map((row) => [row.description, Number(row.amount_minor), row.version, row.deleted])
        .sort(),
    )
    .toEqual([
      ['Keep me', 2000, 2, false],
      ['Made offline', 500, 1, false],
      ['Remove me', 1100, 2, true],
    ]);

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(cached.some((url) => url.endsWith('/index.html') || url.includes('index.html?'))).toBe(
    true,
  );
  expect(cached.filter((url) => new URL(url).pathname.startsWith('/api/'))).toEqual([]);
});

test('a push cut off mid-flight is retried without duplicating the entry', async ({
  page,
  context,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  let pushes = 0;
  await context.route('**/api/v1/sync/push', async (route) => {
    pushes += 1;
    if (pushes > 1) return route.continue();
    // The server applies the push; only the response is lost.
    await route.fetch();
    await route.abort('connectionreset');
  });

  await record(page, '7', 'Bus ticket');

  await expect.poll(() => pushes).toBe(2);
  await expect(badge(page)).toHaveText('Up to date');
  expect(await db.transactions(ann.email)).toMatchObject([
    { description: 'Bus ticket', version: 1, deleted: false },
  ]);
});
