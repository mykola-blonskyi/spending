import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const LAYOUTS = {
  calm: 'Calm minimal',
  cards: 'Card stack',
  soft: 'Soft and friendly',
  journal: 'Journal',
  bento: 'Bento',
  split: 'Split view',
  playful: 'Playful',
  hybrid: 'Hybrid',
} as const;

const DESTINATIONS = [
  'Overview',
  'Transactions',
  'Budgets',
  'Accounts',
  'Categories',
  'Recurring',
  'Imports',
  'Family',
  'Sync',
  'Settings',
];

const shell = (page: Page) => page.locator('[data-layout]');

async function chooseLayout(page: Page, layout: keyof typeof LAYOUTS) {
  if (!page.url().endsWith('/settings')) await page.goto('/settings');
  await page.getByRole('radio', { name: LAYOUTS[layout] }).click();
  await expect(shell(page)).toHaveAttribute('data-layout', layout);
}

/** Follows a destination link, opening "More" (a sheet or a menu) when the link sits behind it. */
async function navigateTo(page: Page, label: string) {
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const direct = nav.getByRole('link', { name: label });
  if ((await direct.count()) > 0 && (await direct.first().isVisible())) {
    await direct.first().click();
    return;
  }
  await page.getByRole('button', { name: 'More' }).locator('visible=true').first().click();
  await page
    .getByRole('menuitem', { name: label })
    .or(page.getByRole('dialog').getByRole('link', { name: label }))
    .click();
}

test('layout and palette persist across a reload', async ({ page, signInAs }) => {
  await signInAs('ann');
  await page.goto('/settings');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'emerald');

  await page.getByRole('radio', { name: 'Rose' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'rose');
  await chooseLayout(page, 'bento');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'rose');
  await expect(shell(page)).toHaveAttribute('data-layout', 'bento');
  await expect(page.getByRole('radio', { name: 'Rose' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: 'Bento' })).toHaveAttribute('aria-checked', 'true');
});

for (const layout of Object.keys(LAYOUTS) as (keyof typeof LAYOUTS)[]) {
  for (const [device, viewport] of [
    ['desktop', { width: 1280, height: 800 }],
    ['phone', { width: 390, height: 844 }],
  ] as const) {
    test(`${layout} layout reaches every destination on ${device}`, async ({ page, signInAs }) => {
      await page.setViewportSize(viewport);
      await signInAs('ann');
      await chooseLayout(page, layout);
      for (const label of DESTINATIONS) {
        await navigateTo(page, label);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(label);
      }
      await page
        .getByRole('link', { name: 'Add transaction' })
        .locator('visible=true')
        .first()
        .click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Add transaction');
    });
  }
}
