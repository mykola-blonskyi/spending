import type { Browser, Page } from '@playwright/test';
import { clientHeaders, expect, signInAs as signInPageAs, test } from './fixtures';
import { APP_ORIGIN, E2E_USERS } from './support/env';

const ann = E2E_USERS.ann;

const badge = (page: Page) =>
  page.getByRole('banner').locator('a[href="/sync"]').getByRole('status');
const row = (page: Page, description: string) =>
  page.getByRole('link', { name: new RegExp(description) });

async function record(page: Page, amount: string, description: string, category: string) {
  await page.goto('/transactions/new');
  await page.getByLabel('Amount').fill(amount);
  await page
    .getByRole('radiogroup', { name: 'Category' })
    .getByRole('radio', { name: category })
    .click();
  await page.getByLabel('Description').fill(description);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
}

async function edit(
  page: Page,
  description: string,
  fields: { amount?: string; description?: string },
) {
  await row(page, description).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit transaction');
  if (fields.amount) await page.getByLabel('Amount').fill(fields.amount);
  if (fields.description) await page.getByLabel('Description').fill(fields.description);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
}

async function remove(page: Page, description: string) {
  await row(page, description).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL('/transactions');
}

/** A second device of the same user, synced with the first. */
async function secondDevice(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: APP_ORIGIN,
    extraHTTPHeaders: clientHeaders(),
  });
  const page = await context.newPage();
  await signInPageAs(page, 'ann');
  await page.goto('/transactions');
  await expect(badge(page)).toHaveText('Up to date');
  return page;
}

async function goOffline(...pages: Page[]) {
  for (const page of pages) {
    await expect(badge(page)).toHaveText('Up to date');
    await page.context().setOffline(true);
  }
}

async function openReview(page: Page, name: string) {
  await badge(page).click();
  await expect(page).toHaveURL('/sync');
  await page.getByRole('button', { name: `Review ${name}` }).click();
  return page.getByRole('dialog', { name: 'Review conflict' });
}

test('two devices edit one entry offline and the conflict is merged field by field', async ({
  page,
  browser,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await record(page, '10', 'Lunch', 'Dining');
  await expect.poll(() => db.transactions(ann.email)).toHaveLength(1);
  const other = await secondDevice(browser);
  await expect(row(other, 'Lunch')).toContainText('€10.00');
  await page.goto('/transactions');
  await goOffline(page, other);

  await edit(page, 'Lunch', { amount: '20' });
  await edit(other, 'Lunch', { description: 'Team lunch' });
  await page.context().setOffline(false);
  await expect
    .poll(() => db.transactions(ann.email))
    .toMatchObject([{ amount_minor: 2000, version: 2 }]);
  await other.context().setOffline(false);

  await expect(badge(other)).toHaveText('1 conflict');
  await expect(row(other, 'Lunch')).toContainText('Needs review');
  await expect(row(other, 'Lunch')).toContainText('€20.00');

  const dialog = await openReview(other, 'Team lunch');
  await expect(dialog).toHaveAccessibleDescription('2 fields differ: Amount, Description.');
  const amount = dialog.getByRole('group', { name: 'Amount, differs' });
  await expect(amount.getByRole('radio', { name: 'Your version: €10.00' })).toBeVisible();
  await expect(amount.getByRole('radio', { name: 'Server version: €20.00' })).toBeChecked();
  const description = dialog.getByRole('group', { name: 'Description, differs' });
  await description.getByRole('radio', { name: 'Server version: Lunch' }).focus();
  await other.keyboard.press('ArrowUp');
  await expect(description.getByRole('radio', { name: 'Your version: Team lunch' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Save merged version' }).focus();
  await other.keyboard.press('Enter');

  await expect(dialog).toBeHidden();
  await expect(other.getByText('Everything is in sync')).toBeVisible();
  await expect(badge(other)).toHaveText('Up to date');
  await other.goto('/transactions');
  await expect(row(other, 'Team lunch')).toContainText('€20.00');
  await expect(row(other, 'Team lunch')).not.toContainText('Needs review');
  await page.reload();
  await expect(row(page, 'Team lunch')).toContainText('€20.00');
  await expect(badge(page)).toHaveText('Up to date');
  expect(await db.transactions(ann.email)).toMatchObject([
    { description: 'Team lunch', amount_minor: 2000, version: 3, deleted: false },
  ]);
  await other.context().close();
});

test('delete-versus-edit and edit conflicts resolve as mine or the server’s on both devices', async ({
  page,
  browser,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await record(page, '7', 'Taxi', 'Transport');
  await record(page, '3', 'Coffee', 'Dining');
  await expect.poll(() => db.transactions(ann.email)).toHaveLength(2);
  const other = await secondDevice(browser);
  await expect(row(other, 'Coffee')).toBeVisible();
  await goOffline(page, other);

  await remove(page, 'Taxi');
  await edit(page, 'Coffee', { amount: '4' });
  await edit(other, 'Taxi', { description: 'Airport taxi' });
  await edit(other, 'Coffee', { description: 'Flat white' });
  await page.context().setOffline(false);
  await expect
    .poll(() => db.transactions(ann.email))
    .toMatchObject([{ deleted: true }, { amount_minor: 400 }]);
  await other.context().setOffline(false);
  await expect(badge(other)).toHaveText('2 conflicts');

  const deleted = await openReview(other, 'Airport taxi');
  await expect(deleted).toHaveAccessibleDescription('Deleted elsewhere, edited on this device');
  await expect(deleted.getByText('Deleted').first()).toBeVisible();
  await deleted.getByRole('button', { name: 'Keep my version' }).click();
  await expect(deleted).toBeHidden();

  const edited = await openReview(other, 'Flat white');
  await expect(edited).toHaveAccessibleDescription('2 fields differ: Amount, Description.');
  await edited.getByRole('button', { name: 'Keep server version' }).click();
  await expect(edited).toBeHidden();
  await expect(badge(other)).toHaveText('Up to date');

  for (const device of [other, page]) {
    await device.goto('/transactions');
    await device.reload();
    await expect(row(device, 'Airport taxi')).toContainText('€7.00');
    await expect(row(device, 'Coffee')).toContainText('€4.00');
    await expect(row(device, 'Flat white')).toHaveCount(0);
  }
  expect(await db.transactions(ann.email)).toMatchObject([
    { description: 'Airport taxi', amount_minor: 700, deleted: false },
    { description: 'Coffee', amount_minor: 400, deleted: false },
  ]);
  await other.context().close();
});
