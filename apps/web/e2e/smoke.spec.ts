import { expect, test } from '@playwright/test';

test('serves the app shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Spending' })).toBeVisible();
});
