import { expect, test } from './fixtures';
import { E2E_USERS } from './support/env';

const ann = E2E_USERS.ann;

function firstOfLastMonth(): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

test('a monthly rule records past dates, pauses, edits only the future and goes', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await page.goto('/recurring');
  await expect(page.getByRole('heading', { name: 'No recurring payments' })).toBeVisible();
  await page.getByRole('link', { name: 'New rule' }).click();
  await expect(page).toHaveURL('/recurring/new');

  await page.getByLabel('Amount').fill('50');
  await page.getByLabel('Description').fill('Rent');
  await page.getByRole('combobox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'Groceries' }).click();
  await expect(page.getByRole('combobox', { name: 'Repeats' })).toHaveText('Monthly');
  await page.getByLabel('Starts on').fill(firstOfLastMonth());
  await page.getByRole('button', { name: 'Create rule' }).click();

  await expect(page).toHaveURL('/recurring');
  const row = page.getByRole('listitem').filter({ hasText: 'Rent' });
  await expect(row).toContainText('Every month on the 1st');
  await expect(row).toContainText('Next: ');
  await expect(row).toContainText('-€50.00');

  await page.goto('/transactions');
  const entries = page.getByRole('link', { name: /Rent/ });
  await expect(entries).toHaveCount(2);
  await expect(entries.first()).toContainText('-€50.00');
  expect(await db.transactions(ann.email)).toHaveLength(2);

  await page.goto('/recurring');
  await row.getByRole('button', { name: 'Pause' }).click();
  await expect(row).toContainText('Paused');
  await expect.poll(() => db.recurringRules(ann.email)).toMatchObject([{ paused: true }]);
  await row.getByRole('button', { name: 'Resume' }).click();
  await expect(row).not.toContainText('Paused');
  await expect.poll(() => db.recurringRules(ann.email)).toMatchObject([{ paused: false }]);

  await row.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit rule');
  await expect(page.getByRole('note')).toContainText('Changes apply to future entries only');
  await page.getByLabel('Amount').fill('60');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL('/recurring');
  await expect(row).toContainText('-€60.00');
  expect(await db.transactions(ann.email)).toMatchObject([
    { amount_minor: 5000, deleted: false },
    { amount_minor: 5000, deleted: false },
  ]);

  await row.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Entries it already recorded stay in your history.');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'No recurring payments' })).toBeVisible();
  expect(await db.recurringRules(ann.email)).toEqual([]);
  expect(await db.transactions(ann.email)).toMatchObject([{ deleted: false }, { deleted: false }]);
});
