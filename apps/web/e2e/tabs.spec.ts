import type { Page } from '@playwright/test';
import { expect, signInAs as signInPageAs, test } from './fixtures';
import { APP_ORIGIN, E2E_USERS } from './support/env';

type Push = { start: number; end: number; mutationIds: string[] };

async function fillEntry(page: Page, amount: string, description: string): Promise<void> {
  await page.goto('/transactions/new');
  await page.getByLabel('Amount').fill(amount);
  await page.getByLabel('Description').fill(description);
}

async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
}

/** Each push this page sent, timed by the browser so pushes from different tabs compare. */
function recordPushes(page: Page, pushes: Push[]): void {
  page.on('requestfinished', (request) => {
    if (!request.url().endsWith('/api/v1/sync/push')) return;
    const { startTime, responseEnd } = request.timing();
    const { mutations } = request.postDataJSON() as { mutations: { mutationId: string }[] };
    pushes.push({
      start: startTime,
      end: startTime + responseEnd,
      mutationIds: mutations.map((mutation) => mutation.mutationId),
    });
  });
}

test('tabs take turns flushing, never overlap and see each other’s entries', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  // A slow server keeps each push open long enough that overlapping flushes would show.
  await page.context().route('**/api/v1/sync/push', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  const tabA = page;
  const tabB = await page.context().newPage();
  const pushes: Push[] = [];
  recordPushes(tabA, pushes);
  recordPushes(tabB, pushes);

  await fillEntry(tabA, '3', 'From tab A');
  await fillEntry(tabB, '4', 'From tab B');
  await Promise.all([save(tabA), save(tabB)]);
  await expect(tabA.getByRole('link', { name: /From tab B/ })).toBeVisible();
  await expect(tabB.getByRole('link', { name: /From tab A/ })).toBeVisible();
  await fillEntry(tabB, '5', 'Also from tab B');
  await save(tabB);
  await expect(tabA.getByRole('link', { name: /Also from tab B/ })).toBeVisible();

  await expect.poll(() => db.transactions(E2E_USERS.ann.email)).toHaveLength(3);
  for (const tab of [tabA, tabB]) {
    await expect(tab.getByRole('banner').getByRole('status')).toHaveText('Up to date');
    await expect(tab.getByRole('link', { name: /from tab/i })).toHaveCount(3);
  }
  expect(pushes.length).toBeGreaterThan(0);
  pushes.sort((a, b) => a.start - b.start);
  for (let i = 1; i < pushes.length; i += 1) {
    expect(pushes[i]!.start, 'pushes overlapped').toBeGreaterThanOrEqual(pushes[i - 1]!.end);
  }
  const sent = pushes.flatMap((push) => push.mutationIds);
  expect(new Set(sent).size).toBe(sent.length);
  const rows = await db.transactions(E2E_USERS.ann.email);
  expect(rows.map((row) => row.description).sort()).toEqual([
    'Also from tab B',
    'From tab A',
    'From tab B',
  ]);
});

test('the visible tab still pulls another device’s entry while the other tab is hidden', async ({
  page,
  browser,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  const hidden = page;
  await hidden.goto('/transactions');
  const visible = await page.context().newPage();
  await visible.goto('/transactions');
  await expect(visible.getByRole('banner').getByRole('status')).toHaveText('Up to date');
  await hidden.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  const device = await browser.newContext({
    baseURL: APP_ORIGIN,
    extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.7' },
  });
  const other = await device.newPage();
  await signInPageAs(other, 'ann');
  await fillEntry(other, '8', 'From another device');
  await save(other);
  await expect.poll(() => db.transactions(E2E_USERS.ann.email)).toHaveLength(1);
  await device.close();

  await visible.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  for (const tab of [visible, hidden]) {
    await expect(tab.getByRole('link', { name: /From another device/ })).toBeVisible();
  }
});
