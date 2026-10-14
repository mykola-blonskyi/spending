import { expect, test } from './fixtures';
import { E2E_USERS } from './support/env';

const ann = E2E_USERS.ann;

test('signing in lands on the shell with the user, and a reload keeps the session', async ({
  page,
  signInAs,
}) => {
  await signInAs('ann');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('banner').getByText(ann.name)).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('button', { name: `Account: ${ann.name}` })).toBeVisible();
});

test('a deep link survives the trip through sign-in', async ({ page, signInAs }) => {
  await page.goto('/budgets?month=2026-10');
  await expect(page).toHaveURL('/signin?returnTo=%2Fbudgets%3Fmonth%3D2026-10');

  await signInAs('ann');
  await expect(page).toHaveURL('/budgets?month=2026-10');
  await expect(page.getByRole('heading', { level: 1, name: 'Budgets' })).toBeVisible();
});

test('signing out ends the session and returns to sign-in', async ({ page, signInAs }) => {
  await signInAs('ann');
  await page.getByRole('button', { name: `Account: ${ann.name}` }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  await expect(page).toHaveURL('/signin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Spending');
  expect(await page.context().cookies()).toEqual([]);

  await page.goto('/settings');
  await expect(page).toHaveURL('/signin?returnTo=%2Fsettings');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Spending');
});

test('profile language is stored on the server and applied on the next sign-in', async ({
  page,
  signInAs,
}) => {
  await signInAs('ann');
  await page.goto('/settings');
  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'Українська' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Налаштування');

  await page.getByRole('button', { name: 'Вийти' }).click();
  await expect(page).toHaveURL('/signin');

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Spending');

  await signInAs('ann');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Огляд');
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
});

test('a failed login is explained in the chosen language', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('spending.locale', 'uk'));
  await page.goto('/signin?error=login_failed');
  await expect(page.getByRole('alert')).toHaveText('Не вдалося завершити вхід. Спробуйте ще раз.');
  await expect(page.getByText('власник має схвалити ваш акаунт')).toBeVisible();
});

test('an ended session sends the user to sign-in and back to where they were', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

  expect(await db.endSessions(ann.email)).toBe(1);
  await page.getByRole('radio', { name: 'Dark' }).click();

  await expect(page).toHaveURL('/signin?returnTo=%2Fsettings&reason=AUTH_REQUIRED');
  await expect(page.getByRole('alert')).toHaveText('Please sign in to continue.');

  await signInAs('ann');
  await expect(page).toHaveURL('/settings');
});
