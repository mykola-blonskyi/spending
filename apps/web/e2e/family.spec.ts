import type { Browser, Page } from '@playwright/test';
import { clientHeaders, expect, signIn, test } from './fixtures';
import { E2E_USERS } from './support/env';

const ann = E2E_USERS.ann;
const bob = E2E_USERS.bob;

async function createFamily(page: Page, name: string) {
  await page.goto('/family');
  await page.getByLabel('Family name').fill(name);
  await page.getByRole('button', { name: 'Create family' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** Creates one invitation link as the owner and returns its URL. */
async function inviteLink(page: Page): Promise<string> {
  await page.goto('/family');
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  const url = await page.getByLabel('Invitation link').inputValue();
  expect(url).toMatch(/\/invite\/[\w-]{43}$/);
  return url;
}

/** A second person on their own device: a fresh context with its own client IP. */
async function secondDevice(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: clientHeaders() });
  return context.newPage();
}

/** Opens an invitation link while signed out: the guard sends the visitor through sign-in. */
async function openLinkAsBob(page: Page, url: string) {
  await page.goto(url);
  await expect(page).toHaveURL(/\/signin\?returnTo=%2Finvite%2F/);
  await signIn(page, 'bob');
}

async function joinThroughLink(page: Page, url: string, familyName: string) {
  await openLinkAsBob(page, url);
  await expect(page.getByRole('heading', { name: `Join ${familyName}?` })).toBeVisible();
  await expect(page.getByText(`${ann.name} invited you`)).toBeVisible();
  await page.getByRole('button', { name: `Join ${familyName}` }).click();
  await expect(page).toHaveURL('/family');
  await expect(page.getByRole('heading', { level: 1, name: familyName })).toBeVisible();
}

async function addEntry(page: Page, description: string, scope?: 'Personal' | 'Family') {
  await page.goto('/transactions/new');
  if (scope) {
    await expect(page.getByRole('radio', { name: 'Personal' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('radio', { name: scope }).click();
  }
  await page.getByLabel('Amount').fill('5');
  await page.getByLabel('Description').fill(description);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Up to date');
}

test('two people share family entries but never personal ones', async ({
  page,
  signInAs,
  browser,
  db,
}) => {
  await signInAs('ann');
  await page.goto('/transactions/new');
  await expect(page.getByRole('radio', { name: 'Family' })).toHaveCount(0);

  await createFamily(page, 'Home');
  await expect(page.getByText('Owner', { exact: true })).toBeVisible();
  const url = await inviteLink(page);

  const bobPage = await secondDevice(browser);
  await joinThroughLink(bobPage, url, 'Home');
  await expect(bobPage.getByRole('list', { name: 'Members' })).toContainText(ann.name);
  await expect(bobPage.getByRole('list', { name: 'Members' })).toContainText(`${bob.name} (you)`);
  await expect(bobPage.getByRole('button', { name: 'Leave family' })).toBeVisible();

  await addEntry(page, 'Ann private', 'Personal');
  await addEntry(page, 'Family dinner', 'Family');
  await addEntry(bobPage, 'Bob private', 'Personal');
  expect(await db.transactions(ann.email)).toMatchObject([
    { description: 'Ann private', scope: 'personal' },
    { description: 'Family dinner', scope: 'family' },
  ]);

  await bobPage.goto('/transactions');
  const dinner = bobPage.getByRole('link', { name: /Family dinner/ });
  await expect(dinner).toBeVisible();
  await expect(dinner).toContainText(`Paid by ${ann.name}`);
  await expect(bobPage.getByRole('link', { name: /Ann private/ })).toHaveCount(0);
  await expect(bobPage.getByRole('link', { name: /Bob private/ })).toBeVisible();

  await page.goto('/transactions');
  await expect(page.getByRole('link', { name: /Family dinner/ })).toContainText(ann.name);
  await expect(page.getByRole('link', { name: /Bob private/ })).toHaveCount(0);

  await page.goto('/family');
  await expect(page.getByRole('list', { name: 'Members' })).toContainText(bob.name);
  await expect(page.getByText('Accepted by Bob Example')).toBeVisible();
  await bobPage.context().close();
});

test('revoked, expired and used links all read the same', async ({
  page,
  signInAs,
  browser,
  db,
}) => {
  await signInAs('ann');
  await createFamily(page, 'Home');
  const bobPage = await secondDevice(browser);
  const invalid = bobPage.getByRole('heading', { name: 'This invitation is no longer valid' });

  const revoked = await inviteLink(page);
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
  await openLinkAsBob(bobPage, revoked);
  await expect(invalid).toBeVisible();

  const expired = await inviteLink(page);
  await db.expireInvitations();
  await bobPage.goto(expired);
  await expect(invalid).toBeVisible();

  const used = await inviteLink(page);
  await bobPage.goto(used);
  await bobPage.getByRole('button', { name: 'Join Home' }).click();
  await expect(bobPage).toHaveURL('/family');
  await bobPage.goto(used);
  await expect(bobPage.getByRole('heading', { name: 'You are already in a family' })).toBeVisible();

  await bobPage.context().close();
});
