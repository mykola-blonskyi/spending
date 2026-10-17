import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { clientHeaders, expect, test } from './fixtures';
import { E2E_USERS } from './support/env';

const ann = E2E_USERS.ann;
const bob = E2E_USERS.bob;
const MERCADONA = 'COMPRA TARJ. 5489XXXX1234 MERCADONA S.A.';

const badge = (page: Page) =>
  page.getByRole('banner').locator('a[href="/sync"]').getByRole('status');
const row = (page: Page, description: string) =>
  page.getByRole('link', { name: new RegExp(description) });

async function record(page: Page, amount: string, description: string, scope?: 'Family') {
  await page.goto('/transactions/new');
  if (scope) await page.getByRole('radio', { name: scope }).click();
  await page.getByLabel('Amount').fill(amount);
  await page.getByLabel('Description').fill(description);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
}

test('the acceptance walk: from sign-in to sign-out across two people', async ({
  page,
  context,
  browser,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  await record(page, '12.50', 'Bakery');
  await expect(row(page, 'Bakery')).toContainText('-€12.50');
  await expect(badge(page)).toHaveText('Up to date');
  await expect.poll(() => db.transactions(ann.email)).toMatchObject([{ description: 'Bakery' }]);

  await context.setOffline(true);
  await expect(badge(page)).toHaveText('Working offline');
  await record(page, '4', 'Train ticket');
  await expect(badge(page)).toHaveText('Working offline, 1 pending');
  await expect(row(page, 'Train ticket')).toContainText('-€4.00');
  expect(await db.transactions(ann.email)).toHaveLength(1);

  await context.setOffline(false);
  await expect(badge(page)).toHaveText('Up to date');
  await expect
    .poll(async () => (await db.transactions(ann.email)).map((r) => r.description))
    .toEqual(['Bakery', 'Train ticket']);

  await page.goto('/family');
  await page.getByLabel('Family name').fill('Home');
  await page.getByRole('button', { name: 'Create family' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  const invitation = await page.getByLabel('Invitation link').inputValue();

  const bobPage = await (await browser.newContext({ extraHTTPHeaders: clientHeaders() })).newPage();
  await bobPage.goto(invitation);
  await expect(bobPage.getByText(`${ann.name} invited you`)).toBeVisible();
  await bobPage.getByRole('link', { name: 'Join Home' }).click();
  await bobPage.getByRole('link', { name: `Sign in as ${bob.name}` }).click();
  await bobPage.waitForURL(/\/invite\//);
  await bobPage.getByRole('button', { name: 'Join Home' }).click();
  await expect(bobPage.getByRole('list', { name: 'Members' })).toContainText(ann.name);

  await record(page, '30', 'Family dinner', 'Family');
  await record(bobPage, '8', 'Bob private');
  await expect(badge(bobPage)).toHaveText('Up to date');
  await expect
    .poll(() => db.transactions(bob.email))
    .toMatchObject([{ description: 'Bob private', scope: 'personal' }]);
  await expect(row(bobPage, 'Bakery')).toHaveCount(0);
  await expect(row(bobPage, 'Family dinner')).toContainText(`Paid by ${ann.name}`);
  await page.reload();
  await expect(row(page, 'Family dinner')).toBeVisible();
  await expect(row(page, 'Bob private')).toHaveCount(0);

  await page.goto('/accounts');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('BBVA');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.goto('/imports/new');
  await page
    .getByLabel('Statement file')
    .setInputFiles(fileURLToPath(new URL('./fixtures/bbva.csv', import.meta.url)));
  await page.getByRole('button', { name: 'Import 6 rows' }).click();
  await expect(page.getByText(/5 rows wait in the review queue/)).toBeVisible();
  await page.goto('/imports/review');
  const pending = page.getByRole('list', { name: 'Review imported rows' }).getByRole('listitem');
  await expect(pending).toHaveCount(5);
  await page.getByRole('checkbox', { name: 'Select all rows' }).click();
  await page
    .getByRole('radiogroup', { name: `Scope: ${MERCADONA}` })
    .getByRole('radio', { name: 'Family' })
    .click();
  await page.getByRole('button', { name: 'Publish 5 rows' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing to review' })).toBeVisible();
  await bobPage.reload();
  await expect(row(bobPage, 'MERCADONA')).toBeVisible();
  await expect(row(bobPage, 'ENDESA')).toHaveCount(0);

  await page.goto('/');
  await page.getByRole('radio', { name: 'Custom' }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-10-03');
  await page.getByLabel('To', { exact: true }).fill('2026-10-05');
  const totals = page.getByRole('region', { name: 'Totals' });
  const tile = (name: string) =>
    totals.locator('div').filter({ has: page.getByText(name, { exact: true }) });
  await expect(tile('Income')).toContainText('€1,500.00');
  await expect(tile('Expenses')).toContainText('€134.17');
  await expect(tile('Period net')).toContainText('€1,365.83');
  await page
    .getByRole('radiogroup', { name: 'Whose money' })
    .getByRole('radio', { name: 'Family' })
    .click();
  await expect(tile('Expenses')).toContainText('€45.67');
  await expect(tile('Income')).toContainText('€0.00');

  await page.goto('/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download CSV/ }).click();
  const csv = await readFile((await (await download).path())!, 'utf8');
  for (const description of ['Bakery', 'Train ticket', 'Family dinner', 'NÓMINA ACME SL']) {
    expect(csv, `export holds ${description}`).toContain(description);
  }
  expect(csv, 'export leaves out the other member’s private entry').not.toContain('Bob private');

  await page.getByRole('button', { name: `Account: ${ann.name}` }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/signin');
  expect(await context.cookies()).toEqual([]);
  await page.goto('/transactions');
  await expect(page).toHaveURL('/signin?returnTo=%2Ftransactions');
  await bobPage.context().close();
});
