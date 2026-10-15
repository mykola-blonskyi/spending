import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_USERS } from './support/env';

const ann = E2E_USERS.ann;

const dialog = (page: Page) => page.getByRole('dialog');

async function pickOption(page: Page, field: string, option: string) {
  await dialog(page).getByRole('combobox', { name: field }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('accounts can be created, renamed, archived and restored', async ({ page, signInAs, db }) => {
  await signInAs('ann');
  await page.goto('/accounts');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Accounts');

  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'New account' })).toBeVisible();
  await dialog(page).getByLabel('Name').fill('Revolut');
  await pickOption(page, 'Type', 'Card');
  await pickOption(page, 'Currency', 'USD');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page)).toBeHidden();

  const row = page.getByRole('listitem').filter({ hasText: 'Revolut' });
  await expect(row).toContainText('Card · USD');
  await expect
    .poll(() => db.accounts(ann.email))
    .toContainEqual({ name: 'Revolut', kind: 'card', currency: 'USD', archived: false });

  await page.getByRole('button', { name: 'Edit Revolut' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Edit account' })).toBeVisible();
  await dialog(page).getByLabel('Name').fill('Revolut USD');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: 'Revolut USD' })).toBeVisible();

  await page.getByRole('button', { name: 'Archive Revolut USD' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Archive Revolut USD?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();

  const archivedSummary = page.getByText(/^Archived \(1\)$/);
  await expect(archivedSummary).toBeVisible();
  await archivedSummary.click();
  await expect(page.getByRole('button', { name: 'Restore Revolut USD' })).toBeVisible();
  await expect
    .poll(() => db.accounts(ann.email))
    .toContainEqual({ name: 'Revolut USD', kind: 'card', currency: 'USD', archived: true });

  // An archived account is not offered for a new transaction.
  await page.goto('/transactions/new');
  await page.getByRole('combobox', { name: 'Account' }).click();
  await expect(page.getByRole('option', { name: 'No account' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Revolut USD' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.goto('/accounts');
  await page.getByText(/^Archived \(1\)$/).click();
  await page.getByRole('button', { name: 'Restore Revolut USD' }).click();
  await expect(page.getByText(/^Archived/)).toHaveCount(0);
  await expect
    .poll(() => db.accounts(ann.email))
    .toContainEqual({ name: 'Revolut USD', kind: 'card', currency: 'USD', archived: false });

  await page.goto('/transactions/new');
  await page.getByRole('combobox', { name: 'Account' }).click();
  await expect(page.getByRole('option', { name: 'Revolut USD' })).toBeVisible();
});

test('the server rejects a second account with the same name and kind', async ({
  page,
  signInAs,
}) => {
  await signInAs('ann');
  await page.goto('/accounts');

  for (const attempt of [1, 2]) {
    await page.getByRole('button', { name: 'Add account' }).click();
    await dialog(page).getByLabel('Name').fill('Revolut USD');
    await pickOption(page, 'Type', 'Card');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    if (attempt === 1) await expect(dialog(page)).toBeHidden();
  }

  await expect(page.getByText('That name is already used. Pick another one.')).toBeVisible();
  // The dialog stays open so the name can be fixed.
  await expect(dialog(page).getByLabel('Name')).toHaveValue('Revolut USD');
});

test('categories can be created, edited, archived and shown in the chosen language', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await page.goto('/categories');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Categories');

  const expenses = page.getByRole('region', { name: 'Expenses' });
  await expect(expenses.getByRole('listitem').filter({ hasText: 'Groceries' })).toBeVisible();

  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'New category' })).toBeVisible();
  await dialog(page).getByLabel('Name', { exact: true }).fill('Coffee');
  await dialog(page).getByRole('radio', { name: '#dc2626' }).check();
  await dialog(page).getByRole('radio', { name: 'coffee', exact: true }).check();
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page)).toBeHidden();

  await expect(expenses.getByRole('listitem').filter({ hasText: 'Coffee' })).toBeVisible();
  await expect
    .poll(() => db.categories(ann.email))
    .toContainEqual({
      name: 'Coffee',
      kind: 'expense',
      color: '#dc2626',
      icon: 'coffee',
      archived: false,
    });

  await page.getByRole('button', { name: 'Edit Coffee' }).click();
  await dialog(page).getByLabel('Name', { exact: true }).fill('Espresso');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(expenses.getByRole('listitem').filter({ hasText: 'Espresso' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Espresso' }).click();
  await dialog(page).getByRole('radio', { name: '#2563eb' }).check();
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect
    .poll(() => db.categories(ann.email))
    .toContainEqual({
      name: 'Espresso',
      kind: 'expense',
      color: '#2563eb',
      icon: 'coffee',
      archived: false,
    });

  await page.getByRole('button', { name: 'Archive Espresso' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(expenses.getByRole('listitem').filter({ hasText: 'Espresso' })).toHaveCount(0);
  await page.getByText(/^Archived \(1\)$/).click();
  await expect(page.getByRole('button', { name: 'Restore Espresso' })).toBeVisible();
  await expect
    .poll(() => db.categories(ann.email))
    .toContainEqual(expect.objectContaining({ name: 'Espresso', archived: true }));

  // A default category follows the language; the stored name is what the rename dialog edits.
  await page.goto('/settings');
  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'Українська' }).click();
  await page.goto('/categories');
  const ukExpenses = page.getByRole('region', { name: 'Витрати' });
  await expect(ukExpenses.getByRole('listitem').filter({ hasText: 'Продукти' })).toBeVisible();
  await page.getByRole('button', { name: 'Змінити: Продукти' }).click();
  await expect(dialog(page).locator('input').first()).toHaveValue('Groceries');
});
