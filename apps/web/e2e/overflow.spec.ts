import { apiCall, expect, test } from './fixtures';
import { E2E_USERS } from './support/env';
import { seedEntries } from './support/seed';

const LAYOUTS = ['calm', 'cards', 'soft', 'journal', 'bento', 'split', 'playful', 'hybrid'];

test('no layout scrolls sideways on a phone in Ukrainian', async ({ page, signInAs, db }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs('ann');
  await seedEntries(page, 12);
  const [entry] = await db.transactions(E2E_USERS.ann.email);
  const screens = [
    '/',
    '/transactions',
    '/transactions/new',
    `/transactions/${entry!.id}`,
    '/accounts',
    '/budgets',
    '/settings',
  ];

  const overflowing: string[] = [];
  for (const layout of LAYOUTS) {
    await apiCall(page, 'PATCH', '/api/v1/me', { locale: 'uk', theme: 'light', layout });
    for (const path of screens) {
      await page.goto(path);
      await expect(page.locator('[data-layout]')).toHaveAttribute('data-layout', layout);
      await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
      await page.waitForLoadState('networkidle');
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      if (width > 390) overflowing.push(`${layout} ${path}: ${width}px`);
    }
  }
  expect(overflowing).toEqual([]);
});
