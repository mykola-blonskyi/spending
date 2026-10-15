import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedEntries } from './support/seed';

const SCREENS = [
  '/',
  '/transactions',
  '/transactions/new',
  '/accounts',
  '/categories',
  '/imports',
  '/imports/new',
  '/budgets',
  '/recurring',
  '/recurring/new',
  '/family',
  '/sync',
  '/settings',
];

async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target.join(' ')) }));
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`every main screen passes axe in ${colorScheme}`, async ({ page, signInAs }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme });
    await page.goto('/signin');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect.soft(await seriousViolations(page), '/signin').toEqual([]);

    await signInAs('ann');
    await page.goto('about:blank');
    await seedEntries(page, 12);
    for (const path of SCREENS) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText('Loading…')).toHaveCount(0);
      expect.soft(await seriousViolations(page), path).toEqual([]);
    }

    await page.goto('/transactions');
    await page.getByRole('list', { name: 'Transactions' }).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    expect.soft(await seriousViolations(page), 'transaction detail').toEqual([]);
  });
}

/** Presses Tab until `target` has focus, as a keyboard user would. */
async function tabTo(page: Page, target: Locator) {
  for (let presses = 0; presses < 40; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

test('an entry is recorded and deleted with the keyboard alone', async ({ page, signInAs }) => {
  await signInAs('ann');
  await page.goto('/transactions/new');

  await tabTo(page, page.getByLabel('Amount'));
  await page.keyboard.type('12.34');
  const categories = page.getByRole('radiogroup', { name: 'Category' }).getByRole('radio');
  await tabTo(page, categories.first());
  await page.keyboard.press('ArrowRight');
  await expect(categories.nth(1)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(categories.nth(1)).toBeChecked();
  await expect(categories.nth(1), 'focus stays on the chosen category').toBeFocused();
  await tabTo(page, page.getByLabel('Description'));
  await page.keyboard.type('Keyboard lunch');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL('/transactions');
  const row = page.getByRole('link', { name: /Keyboard lunch/ });
  await expect(row).toContainText('-€12.34');

  await tabTo(page, row);
  await page.keyboard.press('Enter');
  const remove = page.getByRole('button', { name: 'Delete' });
  await tabTo(page, remove);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();

  await page.keyboard.press('Enter');
  await tabTo(page, dialog.getByRole('button', { name: 'Delete' }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/transactions');
  await expect(row).toHaveCount(0);
});
