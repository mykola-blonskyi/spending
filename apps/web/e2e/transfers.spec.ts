import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { E2E_USERS } from './support/env';
import { createAccount, pushEntries } from './support/seed';

async function september(page: Page) {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Custom' }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-09-01');
  await page.getByLabel('To', { exact: true }).fill('2026-09-30');
  const totals = page.getByRole('region', { name: 'Totals' });
  return (name: string) =>
    totals.locator('div').filter({ has: page.getByText(name, { exact: true }) });
}

test('a move between own accounts marked as a transfer leaves the overview totals', async ({
  page,
  signInAs,
}) => {
  await signInAs('ann');
  const card = await createAccount(page, { name: 'Card', kind: 'card', currency: 'EUR' });
  const savings = await createAccount(page, { name: 'Savings', kind: 'card', currency: 'EUR' });
  await pushEntries(page, [
    { amountMinor: 30_000, occurredOn: '2026-09-10', description: 'To savings', accountId: card },
    {
      kind: 'income',
      amountMinor: 30_000,
      occurredOn: '2026-09-10',
      description: 'From card',
      accountId: savings,
    },
    {
      kind: 'income',
      amountMinor: 200_000,
      occurredOn: '2026-09-01',
      category: 'salary',
      description: 'Pay',
      accountId: card,
    },
    {
      amountMinor: 5_000,
      occurredOn: '2026-09-02',
      category: 'groceries',
      description: 'Market',
      accountId: card,
    },
  ]);

  let tile = await september(page);
  await expect(tile('Income')).toContainText('€2,300.00');
  await expect(tile('Expenses')).toContainText('€350.00');

  await page.goto('/transactions');
  await page.getByRole('link', { name: /To savings/ }).click();
  await page.getByRole('button', { name: 'This is a transfer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mark as a transfer' });
  await expect(dialog.getByRole('radio', { name: /From card/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Mark as transfer' }).click();
  await expect(page.getByText('A transfer has no category.')).toBeVisible();

  tile = await september(page);
  await expect(tile('Income')).toContainText('€2,000.00');
  await expect(tile('Expenses')).toContainText('€50.00');
  await expect(tile('Balance')).toContainText('€1,950.00');
});

test('a transfer is one history row, its side under an account filter, and deletes as a whole', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  const card = await createAccount(page, { name: 'Card', kind: 'card', currency: 'EUR' });
  const savings = await createAccount(page, { name: 'Savings', kind: 'card', currency: 'EUR' });
  await pushEntries(page, [
    { amountMinor: 30_000, occurredOn: '2026-09-10', description: 'To savings', accountId: card },
    {
      kind: 'income',
      amountMinor: 30_000,
      occurredOn: '2026-09-10',
      description: 'From card',
      accountId: savings,
    },
    { amountMinor: 5_000, occurredOn: '2026-09-02', description: 'Market', accountId: card },
  ]);

  await page.goto('/transactions');
  await page.getByRole('link', { name: /To savings/ }).click();
  await page.getByRole('button', { name: 'This is a transfer' }).click();
  await page
    .getByRole('dialog', { name: 'Mark as a transfer' })
    .getByRole('button', { name: 'Mark as transfer' })
    .click();
  await expect(page.getByText('A transfer has no category.')).toBeVisible();

  await page.goto('/transactions');
  const transfer = page.getByRole('link', { name: /Card → Savings/ });
  await expect(transfer).toContainText('€300.00');
  await expect(page.getByRole('link', { name: /From card/ })).toHaveCount(0);

  await page.getByRole('button', { name: /^Open filters/ }).click();
  await page
    .getByRole('dialog', { name: 'Filters' })
    .getByRole('combobox', { name: 'Account' })
    .click();
  await page.getByRole('option', { name: 'Savings', exact: true }).click();
  await page.getByRole('button', { name: 'Show results' }).click();
  await expect(page.getByRole('link', { name: /From card/ })).toContainText('€300.00');
  await expect(transfer).toHaveCount(0);

  await page.getByRole('link', { name: /From card/ }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete this transfer?' });
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL('/transactions');
  await expect(page.getByRole('link', { name: /Market/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /To savings|From card|Card → Savings/ })).toHaveCount(
    0,
  );
  await expect
    .poll(async () =>
      (await db.transactions(E2E_USERS.ann.email)).map((row) => [row.description, row.deleted]),
    )
    .toEqual([
      ['To savings', true],
      ['From card', true],
      ['Market', false],
    ]);
});

async function recordTransfer(
  page: Page,
  { amount, from, to, received }: { amount: string; from: string; to: string; received?: string },
) {
  await page.goto('/transactions/new');
  await page.getByRole('radio', { name: 'Transfer' }).click();
  await page.getByLabel('Amount').fill(amount);
  await page.getByRole('combobox', { name: 'From account' }).click();
  await page.getByRole('option', { name: from }).click();
  await page.getByRole('combobox', { name: 'To account' }).click();
  await page.getByRole('option', { name: to }).click();
  if (received) await page.getByLabel(/^Received/).fill(received);
  await page.getByLabel('Date').fill('2026-09-10');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/transactions');
}

test('a transfer recorded in the entry form is one history row and leaves the totals alone', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  const card = await createAccount(page, { name: 'Card', kind: 'card', currency: 'EUR' });
  await createAccount(page, { name: 'Savings', kind: 'card', currency: 'EUR' });
  await pushEntries(page, [
    {
      kind: 'income',
      amountMinor: 200_000,
      occurredOn: '2026-09-01',
      category: 'salary',
      description: 'Pay',
      accountId: card,
    },
    {
      amountMinor: 5_000,
      occurredOn: '2026-09-02',
      category: 'groceries',
      description: 'Market',
      accountId: card,
    },
  ]);

  await recordTransfer(page, { amount: '300', from: 'Card · EUR', to: 'Savings · EUR' });
  const transfer = page.getByRole('link', { name: /Card → Savings/ });
  await expect(transfer).toHaveCount(1);
  await expect(transfer).toContainText('€300.00');
  await expect(page.getByRole('link', { name: /Pay|Market|Card → Savings/ })).toHaveCount(3);

  const tile = await september(page);
  await expect(tile('Income')).toContainText('€2,000.00');
  await expect(tile('Expenses')).toContainText('€50.00');
  await expect(tile('Balance')).toContainText('€1,950.00');

  await expect
    .poll(async () =>
      (await db.transactions(E2E_USERS.ann.email))
        .filter((row) => row.transfer_id !== null)
        .map((row) => [row.kind, row.amount_minor, row.currency]),
    )
    .toEqual(
      expect.arrayContaining([
        ['expense', 30_000, 'EUR'],
        ['income', 30_000, 'EUR'],
      ]),
    );
});

test('a cross-currency transfer stores each side in its own currency and amount', async ({
  page,
  signInAs,
  db,
}) => {
  await signInAs('ann');
  await createAccount(page, { name: 'Card', kind: 'card', currency: 'EUR' });
  await createAccount(page, { name: 'Hryvnia', kind: 'card', currency: 'UAH' });

  await recordTransfer(page, {
    amount: '100',
    from: 'Card · EUR',
    to: 'Hryvnia · UAH',
    received: '4500',
  });
  const row = page.getByRole('link', { name: /Card → Hryvnia/ });
  await expect(row).toContainText('€100.00');
  await expect(row).toContainText('4,500.00');

  await expect
    .poll(async () => {
      const rows = await db.transactions(E2E_USERS.ann.email);
      return {
        linked: rows.length === 2 && rows[0]?.transfer_id === rows[1]?.transfer_id,
        sides: rows
          .map((side) => [side.kind, side.amount_minor, side.currency, side.transfer_id !== null])
          .sort(),
      };
    })
    .toEqual({
      linked: true,
      sides: [
        ['expense', 10_000, 'EUR', true],
        ['income', 450_000, 'UAH', true],
      ],
    });
});
