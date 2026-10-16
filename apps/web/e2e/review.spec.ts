import { fileURLToPath } from 'node:url';
import { apiCall, expect, signInAs, test } from './fixtures';
import { E2E_USERS } from './support/env';

const ann = E2E_USERS.ann;

test('a family member reviews imported rows and publishes some to the family', async ({
  page,
  browser,
  db,
}) => {
  await signInAs(page, 'ann');
  await apiCall(page, 'POST', '/api/v1/family', { name: 'Examples' });
  const invitation = await apiCall<{ url: string }>(page, 'POST', '/api/v1/family/invitations', {
    expiresInDays: 7,
  });
  const bobContext = await browser.newContext({
    extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.250' },
  });
  const bob = await bobContext.newPage();
  await signInAs(bob, 'bob');
  const token = new URL(invitation.url).pathname.split('/').pop()!;
  await apiCall(bob, 'POST', `/api/v1/invitations/${token}/accept`);

  const { workspaces } = await apiCall<{ workspaces: { id: string; kind: string }[] }>(
    page,
    'GET',
    '/api/v1/workspaces',
  );
  await apiCall(page, 'POST', '/api/v1/accounts', {
    workspaceId: workspaces.find((w) => w.kind === 'personal')!.id,
    name: 'BBVA',
    kind: 'bank',
    currency: 'EUR',
  });
  await page.reload();

  await page.goto('/imports/new');
  await page
    .getByLabel('Statement file')
    .setInputFiles(fileURLToPath(new URL('./fixtures/bbva.csv', import.meta.url)));
  await page.getByRole('button', { name: 'Import 6 rows' }).click();
  await expect(page.getByText(/5 rows wait in the review queue/)).toBeVisible();
  // Pending rows stay out of history (BR-21).
  await page.goto('/transactions');
  await expect(page.getByRole('heading', { name: 'No transactions yet' })).toBeVisible();

  await page.goto('/imports');
  await expect(page.getByText('5 imported rows wait for your review.')).toBeVisible();
  await page.getByRole('link', { name: 'Review' }).click();
  await expect(page).toHaveURL('/imports/review');
  const rows = page.getByRole('list', { name: 'Review imported rows' }).getByRole('listitem');
  await expect(rows).toHaveCount(5);

  await page.getByRole('checkbox', { name: 'Select all rows' }).click();
  await page
    .getByRole('radiogroup', { name: 'Scope for selected' })
    .getByRole('radio', { name: 'Family' })
    .click();
  await expect(rows.and(page.locator('[data-scope="family"]'))).toHaveCount(5);
  // The bulk category list follows the chosen scope and applies per row kind.
  await page.getByRole('combobox', { name: 'Category for selected' }).click();
  await page.getByRole('option', { name: 'Groceries' }).click();
  const mercadona = 'COMPRA TARJ. 5489XXXX1234 MERCADONA S.A.';
  await page
    .getByRole('radiogroup', { name: `Scope: ${mercadona}` })
    .getByRole('radio', { name: 'Personal' })
    .click();
  await expect(rows.and(page.locator('[data-scope="personal"]'))).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: `Category: ${mercadona}` })).toHaveText(
    'Groceries',
  );
  await expect(page.getByRole('combobox', { name: 'Category: NÓMINA ACME SL' })).toHaveText(
    'Salary',
  );
  await expect(page.getByRole('combobox', { name: 'Category: RECIBO ENDESA ENERGÍA' })).toHaveText(
    'Groceries',
  );

  await page.getByRole('button', { name: 'Publish 5 rows' }).click();
  await expect(page.getByText('5 rows published.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nothing to review' })).toBeVisible();
  const history = await db.history(ann.email);
  expect(history.filter((r) => r.review_status === 'confirmed')).toHaveLength(5);
  expect(
    history
      .filter((r) => r.scope === 'family')
      .map((r) => r.category)
      .sort(),
  ).toEqual(['groceries', 'groceries', 'groceries', 'salary']);
  expect(history.find((r) => r.description === mercadona)).toMatchObject({
    scope: 'personal',
    category: 'groceries',
  });
  expect(await db.categoryRules(ann.email)).toContainEqual({
    merchant_key: 'mercadona',
    category: 'groceries',
  });

  await page.goto('/transactions');
  await expect(page.getByRole('link', { name: /MERCADONA/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /ENDESA/ })).toBeVisible();

  // The other member sees the family rows only (BR-2).
  await bob.reload();
  await bob.goto('/transactions');
  await expect(bob.getByRole('link', { name: /ENDESA/ })).toBeVisible();
  await expect(bob.getByRole('link', { name: /CAFÉ PEPE/ })).toHaveCount(2);
  await expect(bob.getByRole('link', { name: /MERCADONA/ })).toHaveCount(0);
  await bobContext.close();
});
