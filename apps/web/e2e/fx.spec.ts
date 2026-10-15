import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_USERS } from './support/env';
import { createAccount } from './support/seed';

const ann = E2E_USERS.ann;

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const enDate = (date: string) =>
  new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
/** The rate date is today's or yesterday's, depending on the profile's timezone. */
const rateDate = new RegExp(`${enDate(day(0))}|${enDate(day(-1))}`);

async function addExpense(page: Page, entry: { amount: string; description: string }) {
  await page.goto('/transactions/new');
  await page.getByLabel('Amount').fill(entry.amount);
  await page.getByLabel('Description').fill(entry.description);
}

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Up to date');
}

test.beforeEach(async ({ page: _page, db }) => {
  for (const offset of [0, -1]) {
    await db.insertFxRate({
      date: day(offset),
      currency: 'USD',
      ratePerEur: '1.0850',
      source: 'ecb',
    });
  }
});

test('a USD entry shows the EUR amount with the original amount, rate, date and source', async ({
  page,
  signInAs,
}) => {
  test.setTimeout(120_000);
  await signInAs('ann');
  await addExpense(page, { amount: '10.85', description: 'Lunch NYC' });
  await page.getByRole('combobox', { name: 'Currency' }).click();
  await page.getByRole('option', { name: 'USD', exact: true }).click();
  await save(page);

  const row = page.getByRole('link', { name: /Lunch NYC/ });
  await expect(row).toContainText('-€10.00');
  await expect(row).toContainText('$10.85 · 1.0850 · ');
  await expect(row).toContainText(rateDate);
  await expect(row).toContainText('ECB');

  await row.click();
  const note = page.getByText(/^Converted to €10\.00 at 1\.0850 \(ECB, /);
  await expect(note).toBeVisible();
  await expect(note).toContainText(rateDate);
});

test('an entry without a rate is marked, totalled apart, and converts after the backfill', async ({
  page,
  signInAs,
  db,
}) => {
  test.setTimeout(180_000);
  await signInAs('ann');
  await createAccount(page, { name: 'Swiss card', kind: 'card', currency: 'CHF' });
  await addExpense(page, { amount: '10.85', description: 'Lunch NYC' });
  await page.getByRole('combobox', { name: 'Currency' }).click();
  await page.getByRole('option', { name: 'USD', exact: true }).click();
  await save(page);

  await addExpense(page, { amount: '5.00', description: 'Zurich tram' });
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: /Swiss card/ }).click();
  await expect(page.getByRole('combobox', { name: 'Currency' })).toHaveText('CHF');
  await save(page);

  const tram = page.getByRole('link', { name: /Zurich tram/ });
  await expect(tram).toContainText('-CHF 5.00');
  await expect(tram).toContainText('Conversion unavailable');
  const unconverted = page.getByText('Not converted', { exact: true }).locator('..');
  await expect(unconverted).toContainText('CHF 5.00');
  const totals = unconverted.locator('..');
  await expect(totals).toContainText('Spent€10.00');

  const [before] = (await db.transactions(ann.email)).filter(
    (t) => t.description === 'Zurich tram',
  );
  await db.insertFxRate({ date: day(0), currency: 'CHF', ratePerEur: '0.9400', source: 'ecb' });
  await db.insertFxRate({ date: day(-1), currency: 'CHF', ratePerEur: '0.9400', source: 'ecb' });
  expect(await db.backfillConversions(ann.email)).toBe(1);
  const [after] = (await db.transactions(ann.email)).filter((t) => t.description === 'Zurich tram');
  expect(after).toMatchObject({ version: before!.version, base_amount_minor: 532 });
  expect(after!.revision).toBeGreaterThan(before!.revision);

  await page.reload();
  await expect(tram).toContainText('-€5.32');
  await expect(tram).toContainText('CHF 5.00 · 0.9400 · ');
  await expect(tram).not.toContainText('Conversion unavailable');
  await expect(page.getByText('Not converted', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Up to date');
  await expect(page.getByText(/conflict/i)).toHaveCount(0);
});
