import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_USERS } from './support/env';

async function record(page: Page, amount: string, description: string): Promise<void> {
  await page.goto('/transactions/new');
  await page.getByLabel('Amount').fill(amount);
  await page.getByLabel('Description').fill(description);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
}

function countPushes(page: Page): () => number {
  let pushes = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/sync/push')) pushes += 1;
  });
  return () => pushes;
}

test('two tabs share one flusher and see each other’s entries', async ({ page, signInAs, db }) => {
  await signInAs('ann');
  const tabA = page;
  const tabB = await page.context().newPage();
  const pushesA = countPushes(tabA);
  const pushesB = countPushes(tabB);
  await tabB.goto('/transactions');
  await expect(tabB.getByRole('banner').getByRole('status')).toHaveText('Up to date');

  await record(tabA, '3', 'From tab A');
  await expect(tabB.getByRole('link', { name: /From tab A/ })).toBeVisible();

  await record(tabB, '4', 'From tab B');
  await record(tabB, '5', 'Also from tab B');
  await expect(tabA.getByRole('link', { name: /Also from tab B/ })).toBeVisible();

  await expect.poll(() => db.transactions(E2E_USERS.ann.email)).toHaveLength(3);
  for (const tab of [tabA, tabB]) {
    await expect(tab.getByRole('banner').getByRole('status')).toHaveText('Up to date');
    await expect(tab.getByRole('link', { name: /from tab/i })).toHaveCount(3);
  }
  expect(pushesA()).toBeGreaterThan(0);
  expect(pushesB()).toBe(0);
  const rows = await db.transactions(E2E_USERS.ann.email);
  expect(rows.map((row) => row.description).sort()).toEqual([
    'Also from tab B',
    'From tab A',
    'From tab B',
  ]);
});
