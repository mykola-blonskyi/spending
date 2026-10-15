import type { Page } from '@playwright/test';
import { APP_ORIGIN } from './env';

const CATEGORY_NAMES = ['Groceries', 'Dining', 'Transport', 'Housing', 'Health', 'Salary'];

/**
 * Seeds `count` entries for the signed-in user through the sync push API, as another device
 * would, spread over two accounts it creates when the user has none ("Wallet" and "Daily card").
 * Descriptions are "Seed <n> <word>", dates walk back one day per 5 entries, currencies
 * cycle EUR/EUR/EUR/USD/GBP, every 7th entry is income.
 */
export async function seedEntries(page: Page, count: number): Promise<void> {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const pull = await (await page.request.get('/api/v1/sync/pull?cursor=0&limit=1000')).json();
  const personal = pull.workspaces.find((w: { kind: string }) => w.kind === 'personal');
  const categories = pull.categories.filter(
    (c: { workspaceId: string }) => c.workspaceId === personal.id,
  );
  const headers = { 'X-CSRF-Token': session.csrfToken, Origin: APP_ORIGIN };
  let accounts = pull.accounts.filter(
    (a: { workspaceId: string }) => a.workspaceId === personal.id,
  );
  if (accounts.length === 0) {
    for (const [name, kind] of [
      ['Wallet', 'cash'],
      ['Daily card', 'card'],
    ] as const) {
      const created = await page.request.post('/api/v1/accounts', {
        headers,
        data: { workspaceId: personal.id, name, kind, currency: 'EUR' },
      });
      if (!created.ok())
        throw new Error(`account failed: ${created.status()} ${await created.text()}`);
      accounts = [...accounts, await created.json()];
    }
  }
  const byName = (name: string, kind: string) =>
    categories.find((c: { name: string; kind: string }) => c.name === name && c.kind === kind);
  const start = new Date();
  const mutations = [];
  for (let n = 1; n <= count; n += 1) {
    const income = n % 7 === 0;
    const date = new Date(start);
    date.setDate(start.getDate() - Math.floor((n - 1) / 5));
    const currency = ['EUR', 'EUR', 'EUR', 'USD', 'GBP'][n % 5]!;
    const category = income
      ? byName('Salary', 'income')
      : byName(CATEGORY_NAMES[n % 5]!, 'expense');
    mutations.push({
      mutationId: crypto.randomUUID(),
      type: 'transaction.upsert',
      baseVersion: null,
      transaction: {
        id: crypto.randomUUID(),
        workspaceId: personal.id,
        kind: income ? 'income' : 'expense',
        amountMinor: 100 + ((n * 37) % 20000),
        currency,
        occurredOn: date.toISOString().slice(0, 10),
        accountId: accounts[n % (accounts.length || 1)]?.id ?? null,
        categoryId: category?.id ?? null,
        description: `Seed ${n} ${CATEGORY_NAMES[n % CATEGORY_NAMES.length]}`,
        note: n % 3 === 0 ? `note ${n}` : '',
      },
    });
  }
  for (let i = 0; i < mutations.length; i += 200) {
    const response = await page.request.post('/api/v1/sync/push', {
      headers,
      data: { mutations: mutations.slice(i, i + 200) },
    });
    if (!response.ok())
      throw new Error(`push failed: ${response.status()} ${await response.text()}`);
  }
}

/** Creates an account in the signed-in user's personal workspace through the API. */
export async function createAccount(
  page: Page,
  account: { name: string; kind: 'cash' | 'card'; currency: string },
): Promise<void> {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const pull = await (await page.request.get('/api/v1/sync/pull?cursor=0&limit=1000')).json();
  const personal = pull.workspaces.find((w: { kind: string }) => w.kind === 'personal');
  const created = await page.request.post('/api/v1/accounts', {
    headers: { 'X-CSRF-Token': session.csrfToken, Origin: APP_ORIGIN },
    data: { workspaceId: personal.id, ...account },
  });
  if (!created.ok()) throw new Error(`account failed: ${created.status()} ${await created.text()}`);
}

type Entry = {
  kind?: 'expense' | 'income';
  amountMinor: number;
  currency?: string;
  occurredOn: string;
  /** A default category of the personal workspace, by English name. */
  category?: string;
  description: string;
};

/** Pushes exact entries into the signed-in user's personal workspace, as another device would. */
export async function pushEntries(page: Page, entries: readonly Entry[]): Promise<void> {
  const session = await (await page.request.get('/api/v1/auth/session')).json();
  const pull = await (await page.request.get('/api/v1/sync/pull?cursor=0&limit=1000')).json();
  const personal = pull.workspaces.find((w: { kind: string }) => w.kind === 'personal');
  const categoryId = (name: string | undefined, kind: string) =>
    pull.categories.find(
      (c: { workspaceId: string; name: string; kind: string }) =>
        c.workspaceId === personal.id && c.name === name && c.kind === kind,
    )?.id ?? null;
  const response = await page.request.post('/api/v1/sync/push', {
    headers: { 'X-CSRF-Token': session.csrfToken, Origin: APP_ORIGIN },
    data: {
      mutations: entries.map(({ kind = 'expense', currency = 'EUR', category, ...entry }) => ({
        mutationId: crypto.randomUUID(),
        type: 'transaction.upsert',
        baseVersion: null,
        transaction: {
          id: crypto.randomUUID(),
          workspaceId: personal.id,
          kind,
          currency,
          accountId: null,
          categoryId: categoryId(category, kind),
          note: '',
          ...entry,
        },
      })),
    },
  });
  if (!response.ok()) throw new Error(`push failed: ${response.status()} ${await response.text()}`);
}
