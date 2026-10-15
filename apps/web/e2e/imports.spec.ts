import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { apiCall, expect, test } from './fixtures';
import { E2E_USERS } from './support/env';

const ann = E2E_USERS.ann;
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** Accounts are edited through REST and reach the device on the next pull, so reload after. */
async function createAccount(page: Page, name: string) {
  const { workspaces } = await apiCall<{ workspaces: { id: string; kind: string }[] }>(
    page,
    'GET',
    '/api/v1/workspaces',
  );
  const personal = workspaces.find((w) => w.kind === 'personal')!;
  await apiCall(page, 'POST', '/api/v1/accounts', {
    workspaceId: personal.id,
    name,
    kind: 'bank',
    currency: 'EUR',
  });
  await page.reload();
}

async function importFile(page: Page, name: string, rows: number) {
  await page.goto('/imports/new');
  await page.getByLabel('Statement file').setInputFiles(fixture(name));
  await page.getByRole('button', { name: new RegExp(`^Import ${rows} rows?$`) }).click();
  await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible();
}

const categoryOf = (page: Page, description: string) =>
  page.getByRole('combobox', { name: `Category: ${description}` });

const stat = (page: Page, label: string) =>
  page
    .locator('dl > div')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator('dd')
    .first();

test('a simple UTF-8 statement is mapped, imported and shows up in history', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await createAccount(page, 'Main');

  await page.goto('/imports');
  await expect(page.getByRole('heading', { name: 'No imports yet' })).toBeVisible();
  await page.getByRole('link', { name: 'Import statement' }).click();
  await expect(page).toHaveURL('/imports/new');
  await page.getByLabel('Statement file').setInputFiles(fixture('simple.csv'));
  await expect(page.getByText('Read as UTF-8, comma-separated: 4 rows.')).toBeVisible();
  // Common header names are guessed; the formats are chosen by hand.
  await expect(page.getByLabel('Date', { exact: true })).toHaveText(/Date/);
  await expect(page.getByLabel('Description')).toHaveText(/Description/);
  await expect(page.getByLabel('Amount', { exact: true })).toHaveText(/Amount/);
  await page.getByLabel('Date format').click();
  await page.getByRole('option', { name: 'Year-Month-Day' }).click();
  await page.getByLabel('Decimal separator').click();
  await page.getByRole('option', { name: 'Dot (12.50)' }).click();
  await expect(page.getByRole('cell', { name: 'Oct 5, 2026' })).toBeVisible();
  await expect(page.locator('#main').getByRole('status')).toHaveText(
    '3 rows ready. 1 row cannot be read and will be rejected',
  );

  await page.getByRole('button', { name: 'Import 4 rows' }).click();
  await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible();
  await expect(stat(page, 'Imported')).toHaveText('3');
  await expect(stat(page, 'Rejected')).toHaveText('1');
  await expect(page.getByRole('row', { name: /^5 / })).toContainText('The date could not be read');

  await page.getByRole('link', { name: 'Open history' }).click();
  await expect(page).toHaveURL('/transactions');
  await expect(page.getByRole('link', { name: /Coffee beans/ })).toContainText('-€12.50');
  await expect(page.getByRole('link', { name: /Refund from shop/ })).toContainText('€15.00');
  expect(await db.history(ann.email)).toMatchObject([
    { description: 'Refund from shop', amount_minor: 1500, review_status: 'confirmed' },
    { description: 'Bus ticket', amount_minor: 240 },
    { description: 'Coffee beans', amount_minor: 1250 },
  ]);
  await page.goto('/imports');
  await expect(page.getByRole('listitem')).toContainText(['simple.csv']);
  await expect(page.getByRole('listitem')).toContainText([
    '3 imported · 0 duplicates · 1 rejected',
  ]);
});

test('a BBVA statement is read as the bank exports it and categorized', async ({
  page,
  signInAs,
}) => {
  await signInAs('ann');
  await createAccount(page, 'BBVA');
  await page.goto('/imports/new');
  await page.getByLabel('Statement file').setInputFiles(fixture('bbva.csv'));
  await expect(page.getByText('Read as Windows-1252, semicolon-separated: 6 rows.')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'BBVA' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#main').getByRole('status')).toHaveText(
    '5 rows ready. 1 row cannot be read and will be rejected',
  );
  await expect(page.getByRole('cell', { name: 'NÓMINA ACME SL' })).toBeVisible();

  await page.getByRole('button', { name: 'Import 6 rows' }).click();
  await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible();
  await expect(stat(page, 'Imported')).toHaveText('5');
  await expect(stat(page, 'Rejected')).toHaveText('1');
  await expect(page.getByRole('row', { name: /^10 / })).toContainText('The date could not be read');
  await expect(categoryOf(page, 'COMPRA TARJ. 5489XXXX1234 MERCADONA S.A.')).toHaveText(
    'Groceries',
  );
  await expect(categoryOf(page, 'NÓMINA ACME SL')).toHaveText('Salary');

  await page.getByRole('link', { name: 'Open history' }).click();
  const mercadona = page.getByRole('link', { name: /MERCADONA/ });
  await expect(mercadona).toContainText('-€45.67');
  await expect(mercadona).toContainText('Groceries');
  await expect(page.getByRole('link', { name: /CAFÉ PEPE/ })).toHaveCount(2);
});

test('a Santander statement is read with its preset, and its reference is the dedupe key', async ({
  page,
  signInAs,
}) => {
  await signInAs('ann');
  await createAccount(page, 'Santander');
  await page.goto('/imports/new');
  await page.getByLabel('Statement file').setInputFiles(fixture('santander.csv'));
  await expect(page.getByText('Read as Windows-1252, semicolon-separated: 3 rows.')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Santander' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByLabel('Transaction ID')).toHaveText(/Referencia/);
  await page.getByRole('button', { name: 'Import 3 rows' }).click();
  await expect(stat(page, 'Imported')).toHaveText('3');
  await expect(categoryOf(page, 'PAGO MOVIL EN LIDL')).toHaveText('Groceries');

  await importFile(page, 'santander.csv', 3);
  await expect(stat(page, 'Imported')).toHaveText('0');
  await expect(stat(page, 'Already imported')).toHaveText('3');
});

test('files over the limits are refused before anything is uploaded', async ({
  page,
  signInAs,
}) => {
  await signInAs('ann');
  await createAccount(page, 'BBVA');
  await page.goto('/imports/new');
  const input = page.getByLabel('Statement file');
  await input.setInputFiles({
    name: 'big.csv',
    mimeType: 'text/csv',
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 0x61),
  });
  await expect(page.getByRole('alert')).toHaveText(
    'This file is larger than 2 MiB. Export a shorter period and try again.',
  );
  await input.setInputFiles({
    name: 'long.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('date,amount,memo\n' + '2026-10-01,-1,x\n'.repeat(5001)),
  });
  await expect(page.getByRole('alert')).toHaveText(
    'This file has more than 5,000 rows. Export a shorter period and try again.',
  );
  await expect(page.getByRole('button', { name: /^Import/ })).toHaveCount(0);
});

test('importing the same statement again adds nothing', async ({ page, signInAs, db }) => {
  await signInAs('ann');
  await createAccount(page, 'BBVA');
  await importFile(page, 'bbva.csv', 6);
  await expect(stat(page, 'Imported')).toHaveText('5');
  await expect(stat(page, 'Already imported')).toHaveText('0');

  await importFile(page, 'bbva.csv', 6);
  await expect(stat(page, 'Imported')).toHaveText('0');
  await expect(stat(page, 'Already imported')).toHaveText('5');
  await expect(stat(page, 'Rejected')).toHaveText('1');
  await expect(
    page.getByText('Rows that were imported before, or deleted since, are skipped.'),
  ).toBeVisible();
  expect(await db.history(ann.email)).toHaveLength(5);
});

test('a corrected category teaches the next import', async ({ page, signInAs, db }) => {
  await signInAs('ann');
  await createAccount(page, 'Santander');
  await importFile(page, 'santander.csv', 3);

  const fruteria = 'COMPRA EN FRUTERÍA PEPE, MÁLAGA';
  await expect(categoryOf(page, fruteria)).toHaveText('Uncategorized');
  await page.getByRole('switch', { name: 'Uncategorized only' }).click();
  await expect(
    page.getByRole('list', { name: 'Imported entries' }).getByRole('listitem'),
  ).toHaveCount(2);

  // Fix the expense in bulk; the income row keeps its kind and is left alone.
  await page.getByRole('checkbox', { name: 'Select all rows' }).click();
  await page.getByRole('combobox', { name: 'Category for selected' }).click();
  await page.getByRole('option', { name: 'Groceries' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(categoryOf(page, fruteria)).toHaveCount(0);
  await page.getByRole('switch', { name: 'Uncategorized only' }).click();
  await expect(categoryOf(page, fruteria)).toHaveText('Groceries');
  await expect(categoryOf(page, 'TRANSFERENCIA DE JUAN PÉREZ')).toHaveText('Uncategorized');
  await categoryOf(page, 'TRANSFERENCIA DE JUAN PÉREZ').click();
  await page.getByRole('option', { name: 'Gifts received' }).click();
  await expect(page.getByText('Every imported entry has a category.')).toBeVisible();
  await expect
    .poll(() => db.categoryRules(ann.email))
    .toEqual([
      { merchant_key: 'fruteria pepe malaga', category: 'Groceries' },
      { merchant_key: 'transferencia juan perez', category: 'Gifts received' },
    ]);

  // A later statement with the same merchant uses what was learned (BR-29).
  await importFile(page, 'santander-later.csv', 1);
  await expect(stat(page, 'Imported')).toHaveText('1');
  await expect(categoryOf(page, fruteria)).toHaveText('Groceries');
});

test('undoing an import keeps the edited entry and lets the statement in again', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await createAccount(page, 'BBVA');
  await importFile(page, 'bbva.csv', 6);

  await page.goto('/transactions');
  await page.getByRole('link', { name: /ENDESA/ }).click();
  await page.getByLabel('Amount').fill('90');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Up to date');
  await expect
    .poll(async () => (await db.history(ann.email)).find((r) => /ENDESA/.test(r.description)))
    .toMatchObject({ version: 2 });

  await page.goto('/imports');
  const batch = page.getByRole('listitem').filter({ hasText: 'bbva.csv' });
  await batch.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('4 entries deleted, 1 kept.')).toBeVisible();
  await expect(batch.getByText('Undone')).toBeVisible();
  await expect(batch.getByRole('button', { name: 'Undo' })).toHaveCount(0);

  await page.goto('/transactions');
  await expect(page.getByRole('link', { name: /ENDESA/ })).toContainText('-€90.00');
  await expect(page.getByRole('link', { name: /MERCADONA/ })).toHaveCount(0);
  expect((await db.history(ann.email)).filter((r) => !r.deleted)).toHaveLength(1);

  // After undo the statement imports again; the kept entry stays a duplicate (BR-30).
  await importFile(page, 'bbva.csv', 6);
  await expect(stat(page, 'Imported')).toHaveText('4');
  await expect(stat(page, 'Already imported')).toHaveText('1');
});
