import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_USERS } from './support/env';

type Push = { start: number; end: number; mutationIds: string[] };

async function fillEntry(page: Page, amount: string, description: string): Promise<void> {
  await page.goto('/transactions/new');
  await page.getByLabel('Amount').fill(amount);
  await page.getByLabel('Description').fill(description);
}

async function settled(...pages: Page[]): Promise<void> {
  for (const page of pages) {
    await expect(page.getByRole('banner').getByRole('status')).toHaveText('Up to date');
  }
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
  const pushesA: Push[] = [];
  const pushesB: Push[] = [];
  recordPushes(tabA, pushesA);
  recordPushes(tabB, pushesB);

  await fillEntry(tabA, '3', 'From tab A');
  await fillEntry(tabB, '4', 'From tab B');
  await Promise.all([save(tabA), save(tabB)]);
  await expect(tabA.getByRole('link', { name: /From tab B/ })).toBeVisible();
  await expect(tabB.getByRole('link', { name: /From tab A/ })).toBeVisible();
  await settled(tabA, tabB);

  // With the other tab idle, a lone write can only be pushed by the tab that made it.
  await fillEntry(tabB, '5', 'Also from tab B');
  await save(tabB);
  await expect(tabA.getByRole('link', { name: /Also from tab B/ })).toBeVisible();
  await settled(tabA, tabB);
  await fillEntry(tabA, '6', 'Again from tab A');
  await save(tabA);
  await expect(tabB.getByRole('link', { name: /Again from tab A/ })).toBeVisible();
  await settled(tabA, tabB);

  for (const tab of [tabA, tabB]) {
    await expect(tab.getByRole('link', { name: /from tab/i })).toHaveCount(4);
  }
  expect(pushesA.length).toBeGreaterThan(0);
  expect(pushesB.length).toBeGreaterThan(0);
  const pushes = [...pushesA, ...pushesB].sort((a, b) => a.start - b.start);
  for (let i = 1; i < pushes.length; i += 1) {
    expect(pushes[i]!.start, 'pushes overlapped').toBeGreaterThanOrEqual(pushes[i - 1]!.end);
  }
  const sent = pushes.flatMap((push) => push.mutationIds);
  expect(new Set(sent).size).toBe(sent.length);
  const rows = await db.transactions(E2E_USERS.ann.email);
  expect(rows.map((row) => row.description).sort()).toEqual([
    'Again from tab A',
    'Also from tab B',
    'From tab A',
    'From tab B',
  ]);
});
