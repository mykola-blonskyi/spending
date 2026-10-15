import { test as base, expect, type Page } from '@playwright/test';
import { E2EDatabase } from './support/database';
import { APP_ORIGIN, E2E_USERS, type E2EUser } from './support/env';

type Fixtures = { signInAs: (user: E2EUser) => Promise<void> };
type WorkerFixtures = { db: E2EDatabase };

export async function signInAs(page: Page, user: E2EUser): Promise<void> {
  const { name } = E2E_USERS[user];
  if (new URL(page.url()).pathname !== '/signin') await page.goto('/signin');
  await page.locator('a[href^="/api/v1/auth/login"]').click();
  await page.getByRole('link', { name: `Sign in as ${name}` }).click();
  await page.waitForURL((url) => url.origin === APP_ORIGIN && url.pathname !== '/signin');
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
}

let testIndex = 0;

/**
 * Calls the API as the signed-in user from inside the page, so cookies, origin and the CSRF
 * token behave exactly as they do for the app. Used to seed what a test needs (an account, a
 * family) without walking through screens that are not under test.
 */
export async function apiCall<T = unknown>(
  page: Page,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const session = await fetch('/api/v1/auth/session').then((r) => r.json());
      const response = await fetch(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': (session as { csrfToken: string }).csrfToken,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text}`);
      return text ? (JSON.parse(text) as unknown) : undefined;
    },
    { method, path, body },
  ) as Promise<T>;
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
    testIndex += 1;
    await use({ 'X-Forwarded-For': `203.0.113.${(testIndex % 254) + 1}` });
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
