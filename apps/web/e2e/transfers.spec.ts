import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_USERS } from './support/env';
import { createAccount, pushEntries } from './support/seed';

async function september(page: Page) {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Custom' }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-09-01');
  await page.getByLabel('To', { exact: true }).fill('2026-09-30');
  const totals = page.getByRole('region', { name: 'Totals' });
  return (name: string) =>
    totals.locator('div').filter({ has: page.getByText(name, { exact: true }) });
}

test('a move between own accounts marked as a transfer leaves the overview totals', async ({
  page,
  signInAs,
}) => {
  await signInAs('ann');
  const card = await createAccount(page, { name: 'Card', kind: 'card', currency: 'EUR' });
  const savings = await createAccount(page, { name: 'Savings', kind: 'card', currency: 'EUR' });
  await pushEntries(page, [
    { amountMinor: 30_000, occurredOn: '2026-09-10', description: 'To savings', accountId: card },
    {
      kind: 'income',
      amountMinor: 30_000,
      occurredOn: '2026-09-10',
      description: 'From card',
      accountId: savings,
    },
    {
      kind: 'income',
      amountMinor: 200_000,
      occurredOn: '2026-09-01',
      category: 'salary',
      description: 'Pay',
      accountId: card,
    },
    {
      amountMinor: 5_000,
      occurredOn: '2026-09-02',
      category: 'groceries',
      description: 'Market',
      accountId: card,
    },
  ]);

  let tile = await september(page);
  await expect(tile('Income')).toContainText('€2,300.00');
  await expect(tile('Expenses')).toContainText('€350.00');

  await page.goto('/transactions');
  await page.getByRole('link', { name: /To savings/ }).click();
  await page.getByRole('button', { name: 'This is a transfer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mark as a transfer' });
  await expect(dialog.getByRole('radio', { name: /From card/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Mark as transfer' }).click();
  await expect(page.getByText('A transfer has no category.')).toBeVisible();

  tile = await september(page);
  await expect(tile('Income')).toContainText('€2,000.00');
  await expect(tile('Expenses')).toContainText('€50.00');
  await expect(tile('Balance')).toContainText('€1,950.00');
});

test('a transfer is one history row, its side under an account filter, and deletes as a whole', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  const card = await createAccount(page, { name: 'Card', kind: 'card', currency: 'EUR' });
  const savings = await createAccount(page, { name: 'Savings', kind: 'card', currency: 'EUR' });
  await pushEntries(page, [
    { amountMinor: 30_000, occurredOn: '2026-09-10', description: 'To savings', accountId: card },
    {
      kind: 'income',
      amountMinor: 30_000,
      occurredOn: '2026-09-10',
      description: 'From card',
      accountId: savings,
    },
    { amountMinor: 5_000, occurredOn: '2026-09-02', description: 'Market', accountId: card },
  ]);

  await page.goto('/transactions');
  await page.getByRole('link', { name: /To savings/ }).click();
  await page.getByRole('button', { name: 'This is a transfer' }).click();
  await page
    .getByRole('dialog', { name: 'Mark as a transfer' })
    .getByRole('button', { name: 'Mark as transfer' })
    .click();
  await expect(page.getByText('A transfer has no category.')).toBeVisible();

  await page.goto('/transactions');
  const transfer = page.getByRole('link', { name: /Card → Savings/ });
  await expect(transfer).toContainText('€300.00');
  await expect(page.getByRole('link', { name: /From card/ })).toHaveCount(0);

  await page.getByRole('button', { name: /^Open filters/ }).click();
  await page
    .getByRole('dialog', { name: 'Filters' })
    .getByRole('combobox', { name: 'Account' })
    .click();
  await page.getByRole('option', { name: 'Savings', exact: true }).click();
  await page.getByRole('button', { name: 'Show results' }).click();
  await expect(page.getByRole('link', { name: /From card/ })).toContainText('€300.00');
  await expect(transfer).toHaveCount(0);

  await page.getByRole('link', { name: /From card/ }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete this transfer?' });
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL('/transactions');
  await expect(page.getByRole('link', { name: /Market/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /To savings|From card|Card → Savings/ })).toHaveCount(
    0,
  );
  await expect
    .poll(async () =>
      (await db.transactions(E2E_USERS.ann.email)).map((row) => [row.description, row.deleted]),
    )
    .toEqual([
      ['To savings', true],
      ['From card', true],
      ['Market', false],
    ]);
});
