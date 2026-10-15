import type { Browser, Page } from '@playwright/test';
import { clientHeaders, expect, test } from './fixtures';
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

/** A signed-out visitor: the preview is public, Join goes through sign-in and comes back. */
async function joinThroughLink(page: Page, url: string, familyName: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: `Join ${familyName}?` })).toBeVisible();
  await expect(page.getByText(`${ann.name} invited you`)).toBeVisible();
  await page.getByRole('link', { name: `Join ${familyName}` }).click();
  await page.getByRole('link', { name: `Sign in as ${bob.name}` }).click();
  await page.waitForURL(/\/invite\//);
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
  await expect(page.getByRole('link', { name: /Family dinner/ })).not.toContainText(ann.name);
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
  await bobPage.goto(revoked);
  await expect(invalid).toBeVisible();

  const expired = await inviteLink(page);
  await db.expireInvitations();
  await bobPage.goto(expired);
  await expect(invalid).toBeVisible();

  const used = await inviteLink(page);
  await joinThroughLink(bobPage, used, 'Home');
  await bobPage.goto(used);
  await expect(bobPage.getByRole('heading', { name: 'You are already in a family' })).toBeVisible();

  await bobPage.getByRole('link', { name: 'Open your family' }).click();
  await bobPage.getByRole('button', { name: 'Leave family' }).click();
  await bobPage.getByRole('alertdialog').getByRole('button', { name: 'Leave family' }).click();
  await expect(bobPage.getByRole('button', { name: 'Create family' })).toBeVisible();
  await bobPage.goto(used);
  await expect(invalid).toBeVisible();
  await bobPage.context().close();
});

test('the owner manages members, reads the log and deletes the family, returning entries', async ({
  page,
  signInAs,
  browser,
  db,
}) => {
  await signInAs('ann');
  await createFamily(page, 'Home');
  const bobPage = await secondDevice(browser);
  await joinThroughLink(bobPage, await inviteLink(page), 'Home');
  await addEntry(bobPage, 'Bob groceries', 'Family');
  await addEntry(page, 'Ann rent', 'Family');

  await page.goto('/family');
  await expect(page.getByText('As the owner you cannot leave')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leave family' })).toHaveCount(0);
  const log = page.getByRole('list', { name: 'Activity' }).getByRole('listitem');
  await expect(log.first()).toHaveText(/Bob Example joined/);
  await expect(log.last()).toHaveText(/Ann Example created the family/);

  await page.getByRole('button', { name: bob.name }).click();
  await page.getByRole('menuitem', { name: 'Make owner' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Transfer ownership' }).click();
  await expect(page.getByRole('button', { name: 'Leave family' })).toBeVisible();
  await expect(log.first()).toHaveText(/Ann Example made Bob Example the owner/);

  await bobPage.goto('/family');
  await bobPage.getByRole('button', { name: ann.name }).click();
  await bobPage.getByRole('menuitem', { name: 'Remove' }).click();
  await bobPage.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(bobPage.getByRole('list', { name: 'Members' })).not.toContainText(ann.name);
  await expect(
    bobPage.getByRole('list', { name: 'Activity' }).getByRole('listitem').first(),
  ).toHaveText(/Bob Example removed Ann Example/);
  await bobPage.goto('/transactions');
  await expect(bobPage.getByRole('link', { name: /Ann rent/ })).toBeVisible();

  await bobPage.goto('/family');
  await bobPage.getByRole('button', { name: 'Delete family' }).click();
  const dialog = bobPage.getByRole('alertdialog');
  await expect(dialog).toContainText('Entries return to their authors');
  await expect(dialog.getByRole('button', { name: 'Delete family' })).toBeDisabled();
  await dialog.getByLabel('Confirmation phrase').fill('Home');
  await dialog.getByRole('button', { name: 'Delete family' }).click();
  await expect(bobPage.getByRole('button', { name: 'Create family' })).toBeVisible();

  await expect
    .poll(() => db.transactions(ann.email))
    .toMatchObject([{ description: 'Ann rent', scope: 'personal' }]);
  await expect
    .poll(() => db.transactions(bob.email))
    .toMatchObject([{ description: 'Bob groceries', scope: 'personal' }]);
  await bobPage.goto('/transactions');
  await expect(bobPage.getByRole('link', { name: /Bob groceries/ })).toBeVisible();
  await expect(bobPage.getByRole('link', { name: /Ann rent/ })).toHaveCount(0);
  await page.goto('/transactions');
  await expect(page.getByRole('link', { name: /Ann rent/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Ann rent/ })).not.toContainText(ann.name);
  await bobPage.context().close();
});
