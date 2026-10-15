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

test('a BBVA statement is read as the bank exports it', async ({ page, signInAs }) => {
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
