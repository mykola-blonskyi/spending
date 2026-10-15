import { test as base, expect, type Page } from '@playwright/test';
import { E2EDatabase } from './support/database';
import { APP_ORIGIN, E2E_USERS, type E2EUser } from './support/env';

type Fixtures = { signInAs: (user: E2EUser) => Promise<void> };
type WorkerFixtures = { db: E2EDatabase };

/**
 * Signs `page` in through the fake provider and waits to land wherever sign-in returns to,
 * which may be outside the shell (an invitation link). `signInAs` also checks the shell.
 */
async function signIn(page: Page, user: E2EUser): Promise<void> {
  const { name } = E2E_USERS[user];
  if (new URL(page.url()).pathname !== '/signin') await page.goto('/signin');
  await page.locator('a[href^="/api/v1/auth/login"]').click();
  await page.getByRole('link', { name: `Sign in as ${name}` }).click();
  await page.waitForURL((url) => url.origin === APP_ORIGIN && url.pathname !== '/signin');
}

export async function signInAs(page: Page, user: E2EUser): Promise<void> {
  await signIn(page, user);
  await expect(page.getByRole('button', { name: new RegExp(E2E_USERS[user].name) })).toBeVisible();
}

let testIndex = 0;

/** A distinct client IP per context, since the API limits sign-ins per IP. */
export function clientHeaders(): Record<string, string> {
  testIndex += 1;
  return { 'X-Forwarded-For': `203.0.113.${(testIndex % 254) + 1}` };
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  db: [
    async ({}, use) => {
      const db = new E2EDatabase();
      await use(db);
      await db.close();
    },
    { scope: 'worker' },
  ],
  // The API limits sign-ins per client IP. Each test is a distinct client, as it would be in reality.
  extraHTTPHeaders: async ({}, use) => {
    await use(clientHeaders());
  },
  page: async ({ page, db }, use) => {
    await db.truncateAll();
    await use(page);
  },
  signInAs: async ({ page }, use) => {
    await use((user) => signInAs(page, user));
  },
});

export { expect };
