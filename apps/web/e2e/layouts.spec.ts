import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedEntries } from './support/seed';

test.setTimeout(180_000);

const LAYOUT_NAMES = { cards: 'Card stack', journal: 'Journal', split: 'Split view' } as const;

async function chooseLayout(page: Page, layout: keyof typeof LAYOUT_NAMES) {
  await page.goto('/settings');
  await page.getByRole('radio', { name: LAYOUT_NAMES[layout] }).click();
  await expect(page.locator('[data-layout]')).toHaveAttribute('data-layout', layout);
}

const search = (page: Page) => page.getByRole('searchbox', { name: 'Search transactions' });
const row = (page: Page, text: string | RegExp) => page.getByRole('link', { name: text });

async function confirmDelete(page: Page) {
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
}

async function press(page: Page, keys: string[]) {
  for (const key of keys) {
    const name = key === '.' ? 'Decimal separator' : key === '<' ? 'Delete last digit' : key;
    await page.getByRole('button', { name, exact: true }).click();
  }
}

test('cards layout: add, edit and delete an entry with the keypad on a phone', async ({
  page,
  signInAs,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs('ann');
  await chooseLayout(page, 'cards');

  await page.goto('/transactions/new');
  const amount = page.getByLabel('Amount');
  await press(page, ['1', '2', '.', '3', '4']);
  await expect(amount).toHaveValue('12.34');
  await page.getByRole('radio', { name: 'Groceries' }).click();
  await page.locator('summary', { hasText: 'More' }).click();
  await page.getByLabel('Description').fill('Coffee beans');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL('/transactions');
  await expect(row(page, /Coffee beans/)).toContainText('-€12.34');

  await row(page, /Coffee beans/).click();
  await expect(page.getByLabel('Amount')).toHaveValue('12.34');
  await press(page, ['<', '<', '<', '<', '<']);
  await expect(amount).toHaveValue('');
  await press(page, ['2', '0']);
  await expect(amount).toHaveValue('20');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
  await expect(row(page, /Coffee beans/)).toContainText('-€20.00');

  await row(page, /Coffee beans/).click();
  await confirmDelete(page);
  await expect(page).toHaveURL('/transactions');
  await expect(row(page, /Coffee beans/)).toHaveCount(0);

  await search(page).fill('Coffee');
  await expect(page.getByRole('heading', { name: 'No matching transactions' })).toBeVisible();
});

test('journal layout: add, find, edit and delete an entry through the sentence form', async ({
  page,
  signInAs,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAs('ann');
  await chooseLayout(page, 'journal');

  await page.goto('/transactions/new');
  await page.getByLabel('Amount').fill('12.34');
  const categoryChip = page.getByRole('button', { name: 'Category', exact: true });
  if ((await categoryChip.getAttribute('aria-expanded')) !== 'true') await categoryChip.click();
  await page
    .getByRole('radiogroup', { name: 'Category' })
    .getByRole('radio', { name: 'Groceries' })
    .click();
  await page.getByRole('button', { name: 'Description', exact: true }).click();
  await page.getByLabel('Description').fill('Coffee beans');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL('/transactions');
  await expect(row(page, /Coffee beans/)).toContainText('-€12.34');
  await search(page).fill('Coffee');
  await expect(row(page, /Coffee beans/)).toBeVisible();

  await row(page, /Coffee beans/).click();
  await expect(page).toHaveURL(/\/transactions\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit transaction');
  await page.getByLabel('Amount').fill('20');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
  await expect(row(page, /Coffee beans/)).toContainText('-€20.00');

  await row(page, /Coffee beans/).click();
  await confirmDelete(page);
  await expect(page).toHaveURL('/transactions');
  await expect(row(page, /Coffee beans/)).toHaveCount(0);
});

test('split layout: the list stays mounted and bounded while the pane edits and deletes', async ({
  page,
  signInAs,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAs('ann');
  await chooseLayout(page, 'split');
  await page.goto('about:blank');
  await seedEntries(page, 300);
  await page.goto('/transactions');

  const list = page.getByRole('list', { name: 'Transactions' });
  const items = list.getByRole('listitem');
  const detail = page.getByRole('region', { name: 'Selected transaction' });
  await expect(list.getByRole('link').first()).toBeVisible({ timeout: 120_000 });

  await search(page).fill('Seed 1');
  await row(page, /Seed 1 /)
    .first()
    .click();
  await expect(page).toHaveURL(/\/transactions\/[^/]+$/);
  await expect(detail.locator('h2').first()).toHaveText(/^Seed 1 /);
  const title = (await detail.locator('h2').first().innerText()).trim();
  await expect(search(page)).toHaveValue('Seed 1');
  await expect(list).toBeVisible();

  await search(page).fill('');
  await page.mouse.move(200, 500);
  for (let tick = 0; tick < 15; tick += 1) await page.mouse.wheel(0, 600);
  await expect(list.getByRole('link').first()).toBeVisible();
  expect(await items.count()).toBeLessThan(80);
  await expect(detail.locator('h2').first()).toHaveText(title);

  await detail.getByRole('button', { name: 'Edit' }).click();
  await detail.getByLabel('Description').fill('Pane edited entry');
  await detail.getByRole('button', { name: 'Save' }).click();
  // Saving in the pane keeps the entry selected.
  await expect(detail.locator('h2').first()).toHaveText('Pane edited entry');
  await search(page).fill('Pane edited');
  await expect(row(page, /Pane edited entry/)).toBeVisible();
  await expect(row(page, /Seed 1 /).filter({ hasText: title })).toHaveCount(0);

  await row(page, /Pane edited entry/).click();
  await expect(detail.locator('h2').first()).toHaveText('Pane edited entry');
  await detail.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(row(page, /Pane edited entry/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No matching transactions' })).toBeVisible();
});
