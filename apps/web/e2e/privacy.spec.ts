import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_USERS } from './support/env';

const ann = E2E_USERS.ann;
const badge = (page: Page) =>
  page.getByRole('banner').locator('a[href="/sync"]').getByRole('status');

async function save(page: Page, description: string) {
  await page.getByLabel('Amount').fill('7');
  await page.getByLabel('Description').fill(description);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
}

async function record(page: Page, description: string) {
  await page.goto('/transactions/new');
  await save(page, description);
}

/** Records an entry the server never receives, so it stays queued on this device. */
async function recordUnsynced(page: Page, description: string) {
  await page.route('**/api/v1/sync/push', (route) => route.abort());
  await record(page, description);
  await expect(badge(page)).toHaveText('Retrying…');
}

async function databaseOf(page: Page): Promise<string> {
  const session = await page.evaluate(() =>
    fetch('/api/v1/auth/session').then((response) => response.json()),
  );
  return `spending-${(session as { user: { id: string } }).user.id}`;
}

const databases = (page: Page) =>
  page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name));

test('signing out with unsynced changes warns, offers to sync and deletes the local database', async ({
  page,
  signInAs,
}) => {
  await signInAs('ann');
  const database = await databaseOf(page);
  await recordUnsynced(page, 'Not yet sent');
  expect(await databases(page)).toContain(database);

  await page.getByRole('button', { name: `Account: ${ann.name}` }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Sign out with unsynced changes?');
  await expect(dialog.getByRole('button', { name: 'Sync now' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign out anyway' }).click();

  await expect(page).toHaveURL('/signin');
  expect(await databases(page)).not.toContain(database);
});

test('another user signing in never sees the previous user data, which is deleted', async ({
  page,
  context,
  signInAs,
}) => {
  await signInAs('ann');
  const annDatabase = await databaseOf(page);
  await recordUnsynced(page, 'Ann private entry');
  await page.unrouteAll();

  await context.clearCookies();
  await signInAs('bob');
  expect(await databases(page)).not.toContain(annDatabase);
  await page.goto('/transactions');
  await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible();
  await expect(badge(page)).toHaveText('Up to date');
  await expect(page.getByText('Ann private entry')).toHaveCount(0);
});

test('a revoked session keeps queued changes, which sync once the same user signs in', async ({
  page,
  context,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await page.goto('/transactions/new');
  await expect(page.getByLabel('Amount')).toBeVisible();
  await context.setOffline(true);
  await save(page, 'Queued before revocation');
  await expect(badge(page)).toHaveText('Working offline, 1 pending');

  expect(await db.endSessions(ann.email)).toBe(1);
  await context.setOffline(false);
  await expect(page).toHaveURL(/\/signin\?/);
  expect(await db.transactions(ann.email)).toEqual([]);

  await signInAs('ann');
  await expect
    .poll(async () => (await db.transactions(ann.email)).map((row) => row.description))
    .toEqual(['Queued before revocation']);
  await page.goto('/transactions');
  await expect(badge(page)).toHaveText('Up to date');
});

test('explains that offline is unavailable when the browser blocks IndexedDB, and still works online', async ({
  page,
  signInAs,
}) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('IndexedDB is blocked', 'InvalidStateError');
    };
  });
  await signInAs('ann');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  await page.goto('/transactions');
  await expect(page.getByText('This device cannot keep your data')).toBeVisible();
  await expect(page.getByText('which Spending needs to work offline')).toBeVisible();
});
