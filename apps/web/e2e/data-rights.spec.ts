import { readFile } from 'node:fs/promises';
import type { Browser, Page } from '@playwright/test';
import { apiCall, clientHeaders, expect, signInAs, test } from './fixtures';
import { E2E_USERS } from './support/env';

const ann = E2E_USERS.ann;

async function addEntry(page: Page, description: string, scope?: 'Personal' | 'Family') {
  await page.goto('/transactions/new');
  if (scope) await page.getByRole('radio', { name: scope }).click();
  await page.getByLabel('Amount').fill('5');
  await page.getByLabel('Description').fill(description);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Up to date');
}

/** Ann (this page) and Bob (a second device) end up in one family owned by `owner`, set up through the API. */
async function familyWithBob(page: Page, browser: Browser, owner: 'ann' | 'bob') {
  const context = await browser.newContext({ extraHTTPHeaders: clientHeaders() });
  const other = await context.newPage();
  const [ownerPage, memberPage] = owner === 'ann' ? [page, other] : [other, page];
  await signInAs(other, 'bob');
  await apiCall(ownerPage, 'POST', '/api/v1/family', { name: 'Home' });
  const { url } = await apiCall<{ url: string }>(ownerPage, 'POST', '/api/v1/family/invitations', {
    expiresInDays: 7,
  });
  await apiCall(memberPage, 'POST', `/api/v1/invitations/${url.split('/').pop()}/accept`);
  return other;
}

async function deleteAccount(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByLabel('Confirmation phrase').fill('DELETE MY DATA');
  await page.getByRole('button', { name: 'Delete account' }).click();
}

test('exports everything as JSON and the transactions as CSV', async ({ page, signInAs }) => {
  await signInAs('ann');
  await addEntry(page, 'Coffee beans');
  await page.goto('/settings');

  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download JSON/ }).click();
  const json = await jsonDownload;
  expect(json.suggestedFilename()).toBe('spending-export.json');
  const document = JSON.parse(await readFile((await json.path())!, 'utf8'));
  expect(document.user.email).toBe(ann.email);
  expect(JSON.stringify(document.transactions)).toContain('Coffee beans');

  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download CSV/ }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toBe('spending-transactions.csv');
  const text = await readFile((await csv.path())!, 'utf8');
  expect(text).toContain('Coffee beans');
});

test('deleting the account signs out, keeps family entries as former member and starts fresh', async ({
  page,
  signInAs,
  browser,
}) => {
  await signInAs('ann');
  const bobPage = await familyWithBob(page, browser, 'bob');
  await addEntry(page, 'Family dinner', 'Family');
  await page.goto('/settings');
  await expect(page.getByText('Family entries you wrote stay')).toBeVisible();

  await deleteAccount(page);
  await expect(page).toHaveURL('/signin');
  expect(await page.context().cookies()).toEqual([]);
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);

  await bobPage.goto('/transactions');
  await expect(bobPage.getByRole('link', { name: /Family dinner/ })).toContainText('Former member');
  await bobPage.context().close();

  await signInAs('ann');
  await page.goto('/transactions');
  await expect(page.getByRole('link', { name: /Family dinner/ })).toHaveCount(0);
  await page.goto('/family');
  await expect(page.getByLabel('Family name')).toBeVisible();
});

test('an owner with other members must transfer ownership or delete the family first', async ({
  page,
  signInAs,
  browser,
}) => {
  await signInAs('ann');
  const bobPage = await familyWithBob(page, browser, 'ann');

  await deleteAccount(page);
  const refusal = page.getByRole('alert');
  await expect(refusal).toContainText('You own a family with other members');
  await expect(page).toHaveURL('/settings');
  await refusal.getByRole('link', { name: 'Go to family settings' }).click();
  await expect(page).toHaveURL('/family');

  await apiCall(page, 'DELETE', '/api/v1/family', { confirmName: 'Home' });
  await deleteAccount(page);
  await expect(page).toHaveURL('/signin');
  await bobPage.context().close();
});
