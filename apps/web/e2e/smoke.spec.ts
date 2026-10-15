import { expect, test } from './fixtures';

test('sign-in page follows the chosen language', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Spending');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
    'href',
    '/api/v1/auth/login?returnTo=%2F',
  );

  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'Українська' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вітаємо в Spending');
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вітаємо в Spending');
});

test('shell navigates between sections', async ({ page, signInAs }) => {
  await signInAs('ann');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Budgets' })
    .click();
  await expect(page).toHaveURL(/\/budgets$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Budgets' })).toBeVisible();
});
