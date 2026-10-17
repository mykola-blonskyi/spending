import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { apiCall, expect, test } from './fixtures';
import { APP_ORIGIN, E2E_USERS } from './support/env';

const ann = E2E_USERS.ann;
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** Accounts are edited through REST and reach the device on the next pull, so reload after. */
async function createAccount(page: Page, name: string, currency = 'EUR') {
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
    currency,
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
  await expect(page.getByLabel('Bank')).toHaveText('BBVA');
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
  await expect(page.getByLabel('Bank')).toHaveText('Santander');
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
      { merchant_key: 'fruteria pepe malaga', category: 'groceries' },
      { merchant_key: 'transferencia juan perez', category: 'gifts_received' },
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

test('an undone import can be removed from the history and its kept entry stays a duplicate', async ({
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
  await expect
    .poll(async () => (await db.history(ann.email)).find((r) => /ENDESA/.test(r.description)))
    .toMatchObject({ version: 2 });

  await page.goto('/imports');
  const batch = page.getByRole('listitem').filter({ hasText: 'bbva.csv' });
  await expect(batch.getByRole('button', { name: 'Remove bbva.csv from history' })).toHaveCount(0);
  await batch.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Undo' }).click();
  await expect(batch.getByText('Undone')).toBeVisible();

  await batch.getByRole('button', { name: 'Remove bbva.csv from history' }).click();
  await expect(batch).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: 'bbva.csv' })).toHaveCount(0);

  await importFile(page, 'bbva.csv', 6);
  await expect(stat(page, 'Imported')).toHaveText('4');
  await expect(stat(page, 'Already imported')).toHaveText('1');
});

test('without a personal account, the import page points to accounts', async ({
  page,
  signInAs,
}) => {
  await signInAs('ann');
  await page.goto('/imports/new');
  await expect(page.getByRole('heading', { name: 'Create an account first' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open accounts' })).toHaveAttribute(
    'href',
    '/accounts',
  );
});

/** The body of the next `POST /imports`, to prove what leaves the browser. */
const importBody = (page: Page) =>
  page
    .waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/v1/imports'))
    .then((r) => r.postData() ?? '');

test('a Santander XLSX is read with its preset, on the transaction date', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await createAccount(page, 'Santander');
  await page.goto('/imports/new');
  await page.getByLabel('Statement file').setInputFiles(fixture('santander.xlsx'));
  await expect(page.getByText('Read as an Excel workbook: 4 rows.')).toBeVisible();
  await expect(page.getByLabel('Bank')).toHaveText('Santander');
  await expect(page.getByLabel('Date', { exact: true })).toHaveText(/Transaction date/);
  await expect(page.getByRole('row', { name: /Mercadona/ })).toContainText('Oct 1, 2026');
  await expect(page.locator('#main').getByRole('status')).toHaveText('4 rows ready');
  const body = importBody(page);
  await page.getByRole('button', { name: 'Import 4 rows' }).click();
  await expect(stat(page, 'Imported')).toHaveText('4');
  for (const secret of ['ES00 0000 1111 2222 3333 4444', 'LUCIA PRUEBA', 'Holder']) {
    expect(await body).not.toContain(secret);
  }
  expect(await db.history(ann.email)).toMatchObject([
    {
      description: 'Pago Movil En Mercadona, Madrid',
      amount_minor: 4567,
      occurred_on: '2026-10-01',
    },
    { description: 'Transferencia De Empresa Ejemplo Sl', amount_minor: 123456 },
    { description: 'Compra Cafeteria Luna, Madrid', amount_minor: 320, occurred_on: '2026-10-05' },
    { description: 'Recibo Electricidad Ejemplo, Madrid', amount_minor: 6000, currency: 'EUR' },
  ]);
});

test('a monobank .xls opens as a workbook and imports the card-currency amount', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await createAccount(page, 'monobank', 'UAH');
  await page.goto('/imports/new');
  await page.getByLabel('Statement file').setInputFiles(fixture('monobank.xls'));
  await expect(page.getByText('Read as an Excel workbook: 4 rows.')).toBeVisible();
  await expect(page.getByLabel('Bank')).toHaveText('monobank');
  await expect(page.getByLabel('Amount', { exact: true })).toHaveText(/Card currency amount/);
  await expect(page.getByLabel('Currency', { exact: true })).toHaveText('Not in this file');
  await expect(page.locator('#main').getByRole('status')).toHaveText('4 rows ready');
  const body = importBody(page);
  await page.getByRole('button', { name: 'Import 4 rows' }).click();
  await expect(stat(page, 'Imported')).toHaveText('4');
  const sent = await body;
  for (const secret of ['Olena', '1234567890', 'UA000000000000000000000000000', '5375']) {
    expect(sent).not.toContain(secret);
  }
  expect(await db.history(ann.email)).toMatchObject([
    { description: 'Silpo', amount_minor: 25050, occurred_on: '2026-10-02' },
    { description: 'Netflix', amount_minor: 43512, currency: 'UAH' },
    { description: 'From: Petro Probnyi', amount_minor: 200000, review_status: 'confirmed' },
    { description: 'ATM Example', amount_minor: 50000, occurred_on: '2026-10-08' },
  ]);
});

test('a PrivatBank file with two cards imports one card, then the next', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await createAccount(page, 'Privat UAH', 'UAH');
  await createAccount(page, 'Privat EUR', 'EUR');
  await page.goto('/imports/new');
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: /Privat UAH/ }).click();
  await page.getByLabel('Statement file').setInputFiles(fixture('privatbank.xlsx'));
  await expect(page.getByLabel('Bank')).toHaveText('PrivatBank');
  // The card in the account's currency comes first.
  await expect(page.getByLabel('Card to import')).toHaveText('5168 **** **** 0001');
  await expect(page.locator('#main').getByRole('status')).toHaveText('3 rows ready');
  const body = importBody(page);
  await page.getByRole('button', { name: 'Import 3 rows' }).click();
  await expect(stat(page, 'Imported')).toHaveText('3');
  expect(await body).not.toContain('**** ****');

  await page.getByRole('button', { name: 'Import card 4149 **** **** 0002' }).click();
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: /Privat EUR/ }).click();
  await expect(page.getByLabel('Card to import')).toHaveText('4149 **** **** 0002');
  await expect(page.locator('#main').getByRole('status')).toHaveText(
    '3 rows ready. 1 row does not match the running balance',
  );
  await expect(
    page.getByRole('table', { name: 'Rows to check' }).getByRole('row', { name: /Restaurant/ }),
  ).toContainText('Balance does not follow from the previous row');
  await page.getByRole('button', { name: 'Import 3 rows' }).click();
  await expect(stat(page, 'Imported')).toHaveText('3');
  await expect(page.getByRole('button', { name: /^Import card/ })).toHaveCount(0);

  const history = await db.history(ann.email);
  expect(history.filter((r) => r.currency === 'UAH').map((r) => r.amount_minor)).toEqual([
    32040, 9500, 1500000,
  ]);
  expect(history.filter((r) => r.currency === 'EUR').map((r) => r.amount_minor)).toEqual([
    4599, 2000, 3050,
  ]);
});

test('the bank category suggests a default category', async ({ page, signInAs, db }) => {
  await signInAs('ann');
  await createAccount(page, 'Privat UAH', 'UAH');
  await page.goto('/imports/new');
  await page.getByLabel('Statement file').setInputFiles(fixture('privatbank-hints.xlsx'));
  await expect(page.getByLabel('Statement category (suggestion only)')).toHaveText(/Категорія/);
  const body = importBody(page);
  await page.getByRole('button', { name: 'Import 2 rows' }).click();
  await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible();
  expect(await body).toContain('Комуналка та Інтернет');
  await expect(categoryOf(page, 'Київводоканал')).toHaveText('Utilities');
  await expect(categoryOf(page, 'Невідома крамниця')).toHaveText('Uncategorized');
  expect((await db.transactions(ann.email)).map((r) => r.description)).toEqual([
    'Київводоканал',
    'Невідома крамниця',
  ]);

  // A choice made on the summary teaches the bank category too; nothing keeps it after.
  await categoryOf(page, 'Невідома крамниця').click();
  await page.getByRole('option', { name: 'Shopping' }).click();
  await expect
    .poll(() => db.categoryRules(ann.email))
    .toEqual([
      { merchant_key: 'bank:різне', category: 'shopping' },
      { merchant_key: 'невідома крамниця', category: 'shopping' },
    ]);
});

test('a legacy .xls is refused, rows without an amount are skipped, a mapping is remembered', async ({
  page,
  signInAs,
}) => {
  await signInAs('ann');
  await createAccount(page, 'Main');
  await page.goto('/imports/new');
  const input = page.getByLabel('Statement file');
  await input.setInputFiles({
    name: 'old.xls',
    mimeType: 'application/vnd.ms-excel',
    buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]),
  });
  await expect(page.getByRole('alert')).toHaveText(
    'This is an old binary Excel file (.xls). Save it as .xlsx or CSV in a spreadsheet app and upload that.',
  );

  const csv = {
    name: 'custom.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Day;Text;Value\n05/10/2026;Bakery;-3,50\n06/10/2026;Pending;—\n'),
  };
  await input.setInputFiles(csv);
  await page.getByLabel('Description').click();
  await page.getByRole('option', { name: /Text/ }).click();
  await page.getByLabel('Amount', { exact: true }).click();
  await page.getByRole('option', { name: /Value/ }).click();
  await page.getByLabel('Date', { exact: true }).click();
  await page.getByRole('option', { name: /Day/ }).click();
  await page.getByLabel('Date format').click();
  await page.getByRole('option', { name: 'Day/Month/Year' }).click();
  await page.getByLabel('Decimal separator').click();
  await page.getByRole('option', { name: 'Comma (12,50)' }).click();
  await expect(page.locator('#main').getByRole('status')).toHaveText(
    '1 row ready. 1 row has no amount and is skipped',
  );
  await expect(
    page.getByRole('table', { name: 'Rows to check' }).getByRole('row', { name: /Pending/ }),
  ).toContainText('No amount in the card currency');
  await page.getByRole('button', { name: 'Import 1 row' }).click();
  await expect(stat(page, 'Imported')).toHaveText('1');

  await page.getByRole('button', { name: 'Import another' }).click();
  await input.setInputFiles(csv);
  await expect(page.getByLabel('Date format')).toHaveText('Day/Month/Year');
  await expect(page.getByLabel('Amount', { exact: true })).toHaveText(/Value/);
  await expect(page.getByRole('button', { name: 'Import 1 row' })).toBeEnabled();
});

/** The production CSP from deploy/security-headers.conf, minus the https upgrade of a local run. */
const PRODUCTION_CSP = readFileSync(
  fileURLToPath(new URL('../../../deploy/security-headers.conf', import.meta.url)),
  'utf8',
)
  .match(/Content-Security-Policy "([^"]+)"/)![1]!
  .replace(/;\s*upgrade-insecure-requests/, '');

test.describe('PDF statements', () => {
  // Requests a service worker answers would bypass the route that adds the CSP.
  test.use({ serviceWorkers: 'block' });

  test('a Santander PDF imports under the production CSP, its worker from our origin', async ({
    page,
    signInAs,
    db,
  }) => {
    await signInAs('ann');
    await createAccount(page, 'Santander');
    // After sign-in: the local OIDC form posts to another port, which form-action forbids.
    await page.route('**/*', async (route) => {
      if (!route.request().url().startsWith(APP_ORIGIN)) return route.continue();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': PRODUCTION_CSP },
      });
    });
    await page.addInitScript(() => {
      const seen: string[] = [];
      Object.assign(window, { cspViolations: seen });
      document.addEventListener('securitypolicyviolation', (event) =>
        seen.push(`${event.violatedDirective} ${event.blockedURI}`),
      );
    });
    await page.goto('/imports/new');
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    await page.getByLabel('Statement file').setInputFiles(fixture('santander.pdf'));
    await expect(page.getByText('Read as a PDF table: 5 rows.')).toBeVisible();
    expect(workers).toContainEqual(
      expect.stringMatching(new RegExp(`^${APP_ORIGIN}/assets/pdf\\.worker.*\\.js$`)),
    );
    expect(
      await page.evaluate(() => (window as { cspViolations?: string[] }).cspViolations),
    ).toEqual([]);
    await expect(page.getByLabel('Bank')).toHaveText('Santander');
    await expect(page.getByLabel('Description')).toHaveText(/Transaction/);
    await expect(page.locator('#main').getByRole('status')).toHaveText('5 rows ready');
    const body = importBody(page);
    await page.getByRole('button', { name: 'Import 5 rows' }).click();
    await expect(stat(page, 'Imported')).toHaveText('5');
    for (const secret of ['Jane Example', 'ES00 0000', 'Holder', 'Document on']) {
      expect(await body).not.toContain(secret);
    }
    expect(await db.history(ann.email)).toMatchObject([
      { description: 'Recibo Gimnasio Norte S.L.', amount_minor: 3500, occurred_on: '2026-09-01' },
      { description: 'Compra Libreria Mar, Madrid, Tarjeta', amount_minor: 1250 },
      { description: /^Recibo Agua Clara/, amount_minor: 2510, occurred_on: '2026-09-30' },
      { description: 'Transferencia Inmediata De Acme Iberia S.L.', amount_minor: 150000 },
      { description: /^Compra Panaderia Sol/, amount_minor: 340, occurred_on: '2026-10-16' },
    ]);
    // Background requests still in flight would otherwise fail inside the next test.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('a signed monobank PDF imports the card-currency amount', async ({ page, signInAs, db }) => {
    await signInAs('ann');
    await createAccount(page, 'monobank', 'UAH');
    await page.goto('/imports/new');
    await page.getByLabel('Statement file').setInputFiles(fixture('monobank-uk.pdf'));
    await expect(page.getByText('Read as a PDF table: 4 rows.')).toBeVisible();
    await expect(page.getByLabel('Bank')).toHaveText('monobank');
    await expect(page.locator('#main').getByRole('status')).toHaveText('4 rows ready');
    const body = importBody(page);
    await page.getByRole('button', { name: 'Import 4 rows' }).click();
    await expect(stat(page, 'Imported')).toHaveText('4');
    for (const secret of ['Петренко', '0000000000', 'UA000000000000000000000000000']) {
      expect(await body).not.toContain(secret);
    }
    expect(await db.history(ann.email)).toMatchObject([
      { description: 'Переказ на картку', amount_minor: 50000, occurred_on: '2026-10-13' },
      { description: 'Netflix', amount_minor: 125000, currency: 'UAH' },
      { description: 'Від: Коваленко Олена Петрівна', amount_minor: 100000 },
      { description: 'Сільпо', amount_minor: 24590, occurred_on: '2026-10-16' },
    ]);
  });

  test('a UkrSibbank PDF joins both tables, skips the row without an amount, leaves holds out', async ({
    page,
    signInAs,
    db,
  }) => {
    await signInAs('ann');
    await createAccount(page, 'UKRSIBBANK', 'UAH');
    await page.goto('/imports/new');
    await page.getByLabel('Statement file').setInputFiles(fixture('ukrsib.pdf'));
    await expect(page.getByText('Read as a PDF table: 7 rows.')).toBeVisible();
    await expect(page.getByLabel('Bank')).toHaveText('UKRSIBBANK');
    await expect(page.locator('#main').getByRole('status')).toHaveText(
      '6 rows ready. 1 row has no amount and is skipped',
    );
    await page.getByRole('button', { name: 'Import 6 rows' }).click();
    await expect(stat(page, 'Imported')).toHaveText('6');
    expect(await db.history(ann.email)).toMatchObject([
      { description: /SHOP TX02/, amount_minor: 8000, occurred_on: '2026-10-10' },
      { description: /Cafe Sol TX01/, amount_minor: 19530, currency: 'UAH' },
      { description: 'Комісія за переказ', amount_minor: 500 },
      { description: 'Заробітна плата та аванси від ТОВ "ПРИКЛАД СОФТ"', amount_minor: 2000000 },
      { description: 'Зарахування миттєвого переказу · Повернення боргу', amount_minor: 300000 },
      { description: /^Оплата послуг за допомогою інтернет-банкінгу · /, amount_minor: 25000 },
    ]);
  });

  test('a scanned PDF is refused with a clear message', async ({ page, signInAs }) => {
    await signInAs('ann');
    await createAccount(page, 'Santander');
    await page.goto('/imports/new');
    await page.getByLabel('Statement file').setInputFiles(fixture('scanned.pdf'));
    await expect(page.getByRole('alert')).toHaveText(
      'This PDF has no text, only images (a scan). Download the statement from your bank as a PDF with text, an XLSX or a CSV.',
    );
  });
});

/** The #110 transfer statements: ISO dates and a dot as the decimal separator. */
async function importTransferStatement(page: Page, account: string, name: string, rows: number) {
  await page.goto('/imports/new');
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: new RegExp(account) }).click();
  await page.getByLabel('Statement file').setInputFiles(fixture(name));
  await page.getByLabel('Date format').click();
  await page.getByRole('option', { name: 'Year-Month-Day' }).click();
  await page.getByLabel('Decimal separator').click();
  await page.getByRole('option', { name: 'Dot (12.50)' }).click();
  await page.getByRole('button', { name: new RegExp(`^Import ${rows} rows?$`) }).click();
  await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible();
}

test('two statements of own accounts suggest the transfer between them, linked on confirm', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await createAccount(page, 'Main');
  await createAccount(page, 'Savings');
  const importInto = (account: string, name: string, rows: number) =>
    importTransferStatement(page, account, name, rows);
  const suggestion = (description: string) =>
    page.getByRole('listitem', { name: `Suggested transfer: ${description}` });

  await importInto('Main', 'transfer-main.csv', 3);
  // Nothing on Savings yet; the user's own name still hints at a transfer.
  await expect(suggestion('To Ann Example')).toContainText('Own account outside the app');
  await expect(suggestion('To savings')).toHaveCount(0);
  await suggestion('To Ann Example').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('heading', { name: 'Looks like a transfer' })).toHaveCount(0);

  await importInto('Savings', 'transfer-savings.csv', 1);
  const pair = suggestion('From main card');
  await expect(pair).toContainText('Other side: Main, Oct 5, 2026');
  await pair.getByRole('button', { name: 'Confirm' }).click();
  await expect(pair).toHaveCount(0);
  // A transfer has no category, so the summary stops asking for one.
  await expect(categoryOf(page, 'From main card')).toHaveCount(0);

  await page.getByRole('link', { name: 'Open history' }).click();
  const transfer = page.getByRole('link', { name: /Main → Savings/ });
  await expect(transfer).toContainText('€300.00');
  await expect(page.getByRole('link', { name: /From main card/ })).toHaveCount(0);
  await expect
    .poll(async () => {
      const sides = (await db.transactions(ann.email)).filter((r) => r.transfer_id !== null);
      return [sides.length, new Set(sides.map((r) => r.transfer_id)).size];
    })
    .toEqual([2, 1]);
});

test('a family member links two rows awaiting review as one transfer', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await apiCall(page, 'POST', '/api/v1/family', { name: 'Examples' });
  await createAccount(page, 'Main');
  await createAccount(page, 'Savings');
  await importTransferStatement(page, 'Main', 'transfer-main.csv', 3);
  await importTransferStatement(page, 'Savings', 'transfer-savings.csv', 1);

  await page.goto('/imports/review');
  const rowOf = (description: string) =>
    page
      .getByRole('list', { name: 'Review imported rows' })
      .getByRole('listitem')
      .filter({ has: page.getByRole('checkbox', { name: `Select ${description}` }) });
  await expect(rowOf('From main card')).toContainText(
    'Looks like a transfer · Other side: Main, Oct 5, 2026',
  );
  await expect(rowOf('To savings')).toContainText('Other side: Savings, Oct 6, 2026');
  await expect(rowOf('To Ann Example')).toContainText('Own account outside the app');
  await expect(rowOf('Coffee beans').getByRole('button', { name: /^Transfer/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Transfer: From main card' }).click();
  await expect(page.getByRole('button', { name: 'Transfer: To savings' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('combobox', { name: 'Category: To savings' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Select From main card' }).click();
  await page.getByRole('button', { name: 'Publish 2 rows' }).click();
  await expect(rowOf('From main card')).toHaveCount(0);
  await expect(rowOf('To savings')).toHaveCount(0);

  await page.goto('/transactions');
  const transfer = page.getByRole('link', { name: /Main → Savings/ });
  await expect(transfer).toContainText('€300.00');
  await expect(page.getByRole('link', { name: /From main card/ })).toHaveCount(0);
  const sides = (await db.transactions(ann.email)).filter((r) => r.transfer_id !== null);
  expect(sides).toHaveLength(2);
  expect(new Set(sides.map((r) => r.transfer_id)).size).toBe(1);
  expect(sides.map((r) => r.scope)).toEqual(['personal', 'personal']);
  const linked = (await db.history(ann.email)).filter((r) =>
    ['To savings', 'From main card'].includes(r.description),
  );
  expect(linked.map((r) => [r.review_status, r.category])).toEqual([
    ['confirmed', null],
    ['confirmed', null],
  ]);
});
