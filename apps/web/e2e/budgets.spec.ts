import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function recordGroceries(page: Page, amount: string) {
  await page.goto('/transactions/new');
  await page.getByLabel('Amount').fill(amount);
  await page.getByRole('combobox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'Groceries' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Up to date');
}

test('a monthly budget tracks spending, then its limit changes and it goes', async ({
  page,
  signInAs,
}) => {
  await signInAs('ann');
  await page.goto('/budgets');
  await expect(page.getByRole('heading', { name: 'No budgets yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Set a budget' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'Groceries' }).click();
  await dialog.getByLabel('Monthly limit in EUR').fill('100');
  await dialog.getByRole('button', { name: 'Set a budget' }).click();
  await expect(dialog).toBeHidden();

  const bar = page.getByRole('progressbar', { name: 'Groceries' });
  const row = page.getByRole('listitem').filter({ has: bar });
  await expect(bar).toHaveAttribute('aria-valuetext', '€0.00 of €100.00');
  await expect(row).toContainText('On track');
  await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.getByRole('button', { name: 'Next month' })).toBeEnabled();
  await page.getByRole('button', { name: 'This month' }).click();

  await recordGroceries(page, '90');
  await page.goto('/budgets');
  await expect(bar).toHaveAttribute('aria-valuetext', '€90.00 of €100.00');
  await expect(row).toContainText('Near the limit');

  await recordGroceries(page, '20');
  await page.goto('/budgets');
  await expect(bar).toHaveAttribute('aria-valuetext', '€110.00 of €100.00');
  await expect(row).toContainText('Over by €10.00');
  await expect(bar).toHaveAttribute('aria-valuenow', '100');

  await row.getByRole('button', { name: 'Change limit' }).click();
  await expect(dialog.getByLabel('Monthly limit in EUR')).toHaveValue('100.00');
  await dialog.getByLabel('Monthly limit in EUR').fill('200');
  await dialog.getByRole('button', { name: 'Change limit' }).click();
  await expect(dialog).toBeHidden();
  await expect(bar).toHaveAttribute('aria-valuetext', '€110.00 of €200.00');
  await expect(row).toContainText('On track');

  await row.getByRole('button', { name: 'Delete budget' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete budget' }).click();
  await expect(page.getByRole('heading', { name: 'No budgets yet' })).toBeVisible();
});
