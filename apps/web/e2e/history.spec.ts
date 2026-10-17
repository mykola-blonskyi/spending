import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedEntries } from './support/seed';

const ENTRIES = 5000;
const DOM_BUDGET = 80;

// Seeding and the first pull of 5,000 entries are slow on a loaded machine.
test.setTimeout(240_000);

const list = (page: Page) => page.getByRole('list', { name: 'Transactions' });
const items = (page: Page) => list(page).getByRole('listitem');
const rows = (page: Page) => list(page).getByRole('link');

async function openSeededHistory(page: Page) {
  // The signed-in app syncs in the background; leave it while another device "pushes".
  await page.goto('about:blank');
  await seedEntries(page, ENTRIES);
  await page.goto('/transactions');
  await expect(rows(page).first()).toBeVisible({ timeout: 120_000 });
}

async function openFilters(page: Page) {
  await page.getByRole('button', { name: /^Open filters/ }).click();
  await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
}

async function closeFilters(page: Page) {
  await page.getByRole('button', { name: 'Show results' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

/** Picks an option of one of the filter sheet's selects, leaving the sheet open. */
async function pickFilter(page: Page, field: string, option: string) {
  await page
    .getByRole('dialog', { name: 'Filters' })
    .getByRole('combobox', { name: field })
    .click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function resetFilters(page: Page) {
  await page.getByRole('button', { name: 'Reset' }).click();
}

async function expectAllRows(page: Page, text: string) {
  await expect(rows(page).first()).toBeVisible();
  await expect(rows(page).filter({ hasNotText: text })).toHaveCount(0);
}

const scroller = (page: Page) => list(page).locator('..');
const scrollTo = (page: Page, fraction: number) =>
  scroller(page).evaluate(
    (el, f) => el.scrollTo(0, (el.scrollHeight - el.clientHeight) * f),
    fraction,
  );
const scrollTop = (page: Page) => scroller(page).evaluate((el) => el.scrollTop);

test('a 5,000-entry history scrolls in its own box with a bounded DOM, on desktop and phone', async ({
  page,
  signInAs,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAs('ann');
  await openSeededHistory(page);
  const search = page.getByRole('searchbox', { name: 'Search transactions' });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await scrollTo(page, 0);
    expect(await items(page).count()).toBeLessThan(DOM_BUDGET);
    const box = (await scroller(page).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    await scrollTo(page, 0.5);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(1000);
    await expect(rows(page).first()).toBeVisible();
    expect(await items(page).count()).toBeLessThan(DOM_BUDGET);

    // Row heights are measured as they scroll into view, so the first jump falls short of the end.
    await expect(async () => {
      await scrollTo(page, 1);
      await expect(rows(page).last()).toContainText('Seed 4996', { timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    expect(await scrollTop(page)).toBeGreaterThan(100_000);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await expect(search).toBeInViewport();
    await expect(rows(page).last()).toBeInViewport();
    expect(await items(page).count()).toBeLessThan(DOM_BUDGET);

    // A row focused below the box's bottom edge scrolls into view inside the box.
    await scrollTo(page, 0);
    const below = rows(page).last();
    await expect(below).not.toBeInViewport();
    await below.focus();
    await expect(below).toBeInViewport();
    expect(await page.evaluate(() => scrollY)).toBe(0);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await scrollTo(page, 0);
  const area = (await scroller(page).boundingBox())!;
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  for (let tick = 0; tick < 20; tick += 1) await page.mouse.wheel(0, 600);
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(1000);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(search).toBeInViewport();
  await expect(rows(page).first()).toBeVisible();
  expect(await items(page).count()).toBeLessThan(DOM_BUDGET);
});

test('search and every filter narrow a 5,000-entry history', async ({ page, signInAs }) => {
  await signInAs('ann');
  await openSeededHistory(page);

  const search = page.getByRole('searchbox', { name: 'Search transactions' });
  await search.fill('Seed 4999');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText('Seed 4999');
  await search.fill('');
  await expect(rows(page).nth(1)).toBeVisible();

  // Type: income is only ever Salary.
  await page.getByRole('radio', { name: 'Income' }).click();
  await expectAllRows(page, 'Salary');
  await page.getByRole('radio', { name: 'All' }).click();

  await openFilters(page);
  await pickFilter(page, 'Category', 'Dining');
  await closeFilters(page);
  await expectAllRows(page, 'Dining');

  await openFilters(page);
  await resetFilters(page);
  await pickFilter(page, 'Account', 'Wallet');
  await closeFilters(page);
  await expectAllRows(page, 'Wallet');

  await openFilters(page);
  await resetFilters(page);
  await pickFilter(page, 'Currency', 'USD');
  await closeFilters(page);
  await expectAllRows(page, '$');

  // Period: all five entries of one day, and nothing else.
  const day = new Date();
  day.setDate(day.getDate() - 100);
  const date = day.toISOString().slice(0, 10);
  await openFilters(page);
  await resetFilters(page);
  await page.getByLabel('From').fill(date);
  await page.getByLabel('To').fill(date);
  await closeFilters(page);
  await expect(rows(page)).toHaveCount(5);
  await expect(list(page).getByRole('heading')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Remove filter/ })).toHaveCount(1);

  await page.getByRole('button', { name: /^Remove filter/ }).click();
  await expect(rows(page).nth(6)).toBeVisible();
});

test('the filter sheet works on a phone', async ({ page, signInAs }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs('ann');
  await openSeededHistory(page);
  expect(await items(page).count()).toBeLessThan(DOM_BUDGET);

  await openFilters(page);
  await page
    .getByRole('dialog', { name: 'Filters' })
    .getByRole('radio', { name: 'Income' })
    .click();
  await pickFilter(page, 'Category', 'Salary');
  await closeFilters(page);
  await expectAllRows(page, 'Salary');
  expect(await items(page).count()).toBeLessThan(DOM_BUDGET);

  await page
    .getByRole('button', { name: /^Remove filter/ })
    .first()
    .click();
  await page.getByRole('radio', { name: 'All' }).click();
  await expect(rows(page).nth(5)).toBeVisible();
});

test('the table view on desktop covers the whole history and is remembered', async ({
  page,
  signInAs,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAs('ann');
  await openSeededHistory(page);

  await page.getByRole('radio', { name: 'Table' }).click();
  const table = page.getByRole('table', { name: 'Transactions' });
  const tableRows = table.locator('[role="row"][aria-rowindex]:not([aria-rowindex="1"])');
  await expect(table).toHaveAttribute('aria-rowcount', String(ENTRIES + 1));
  await expect(table.getByRole('columnheader', { name: 'Amount' })).toBeVisible();
  await expect(tableRows.first()).toBeVisible();
  expect(await tableRows.count()).toBeLessThan(DOM_BUDGET);

  // The table scrolls in its own box under the controls; the page stays put.
  const scroller = table.locator('.overflow-y-auto');
  const box = await scroller.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  const scrollTable = (fraction: number) =>
    scroller.evaluate((el, f) => el.scrollTo(0, (el.scrollHeight - el.clientHeight) * f), fraction);
  await expect(async () => {
    await scrollTable(1);
    await expect(tableRows.last()).toContainText('Seed 4996', { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  expect(await tableRows.count()).toBeLessThan(DOM_BUDGET);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100_000);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(table.getByRole('button', { name: 'Date', exact: true })).toBeInViewport();

  await scrollTable(0);
  const newest = table.getByRole('link').first();
  await expect(newest).toHaveText('Seed 5 Salary');
  await newest.press('Enter');
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel('Description')).toHaveValue('Seed 5 Salary');

  await page.goBack();
  await page.reload();
  // The reload reads all entries from the local store again, as slowly as the first open.
  await expect(table.getByRole('link').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('radio', { name: 'Table' })).toBeChecked();

  // The largest EUR amounts the seed makes; USD and GBP have no rate here, so they go last.
  const largest = [/^Seed 1081 /, /^Seed 2162 /, /^Seed 540 /];
  const sortByAmount = table.getByRole('button', { name: 'Amount', exact: true });
  const amountHeader = table
    .getByRole('columnheader')
    .filter({ has: page.getByRole('button', { name: 'Amount', exact: true }) });
  await scrollTable(0.5);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
  await sortByAmount.click();
  await expect(amountHeader).toHaveAttribute('aria-sort', 'descending');
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0);
  for (const [index, text] of largest.entries())
    await expect(table.getByRole('link').nth(index)).toHaveText(text);
  await page.reload();
  await expect(table.getByRole('link').first()).toBeVisible({ timeout: 120_000 });
  await expect(amountHeader).toHaveAttribute('aria-sort', 'descending');
  for (const [index, text] of largest.entries())
    await expect(table.getByRole('link').nth(index)).toHaveText(text);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('radio', { name: 'Table' })).toHaveCount(0);
  await expect(rows(page).first()).toBeVisible();
});
