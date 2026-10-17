import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/database/migrate';
import { accounts, categories, transactions, workspaces } from '../src/database/schema';
import { testDatabaseUrl } from './env';
import { type FakeOidc, startFakeOidc } from './fake-oidc/server';
import {
  loginAs,
  resetData,
  type Session,
  startTestApp,
  TEST_CLIENT,
  type TestApp,
  workspacesOf,
} from './harness';

const people = [{ sub: 'sub-ann', email: 'ann@example.test', name: 'Ann' }] as const;

/** Runs one migration file again on existing rows; the schema statements are idempotent. */
async function replay(t: TestApp, file: string): Promise<void> {
  const text = readFileSync(resolve(__dirname, '../drizzle', file), 'utf8');
  for (const statement of text.split('--> statement-breakpoint')) {
    await t.db.execute(sql.raw(statement));
  }
}

describe('migrations', () => {
  let provider: FakeOidc;
  let t: TestApp;
  let ann: Session;

  beforeAll(async () => {
    provider = await startFakeOidc({ users: people, clients: [TEST_CLIENT] });
    t = await startTestApp({ OIDC_ISSUER: provider.issuer });
  });
  beforeEach(async () => {
    await resetData(t.db);
    ann = await loginAs(t, people[0].sub);
  });
  afterAll(async () => {
    await t.app.close();
    await provider.close();
  });

  it('gives up on a held lock instead of queueing every query behind it', async () => {
    const holder = new Client({ connectionString: testDatabaseUrl });
    await holder.connect();
    try {
      await holder.query('begin');
      await holder.query('lock table drizzle.__drizzle_migrations in access exclusive mode');
      await expect(runMigrations(testDatabaseUrl)).rejects.toMatchObject({
        cause: { code: '55P03' },
      });
    } finally {
      await holder.query('rollback');
      await holder.end();
    }
  }, 20_000);

  it('0010 drops the seeded English names and keeps the ones users set', async () => {
    const { personal } = await workspacesOf(t, ann);
    const inWorkspace = (key: string) =>
      and(eq(categories.workspaceId, personal), eq(categories.systemKey, key));
    await t.db.update(workspaces).set({ name: 'Personal' }).where(eq(workspaces.id, personal));
    await t.db.update(categories).set({ name: 'Groceries' }).where(inWorkspace('groceries'));
    await t.db.update(categories).set({ name: 'Other' }).where(inWorkspace('other_income'));
    await t.db.update(categories).set({ name: 'Pizza nights' }).where(inWorkspace('dining'));

    await replay(t, '0010_stored_names_nullable.sql');

    const nameOf = async (key: string) =>
      (await t.db.select({ name: categories.name }).from(categories).where(inWorkspace(key)))[0]!
        .name;
    expect(await nameOf('groceries')).toBeNull();
    expect(await nameOf('other_income')).toBeNull();
    expect(await nameOf('dining')).toBe('Pizza nights');
    expect(
      (
        await t.db
          .select({ name: workspaces.name })
          .from(workspaces)
          .where(eq(workspaces.id, personal))
      )[0]!.name,
    ).toBeNull();
  });

  it('0010 refuses a workspace with two categories under one system key', async () => {
    const { personal } = await workspacesOf(t, ann);
    await t.db.execute(sql`drop index if exists categories_system_key_uq`);
    await t.db.insert(categories).values({
      workspaceId: personal,
      name: 'Food',
      kind: 'expense',
      color: '#000000',
      icon: 'apple',
      systemKey: 'groceries',
    });
    await expect(replay(t, '0010_stored_names_nullable.sql')).rejects.toThrow(/share a system_key/);
  });

  it('0013 refuses an entry in a currency other than its account’s (BR-39)', async () => {
    const { personal } = await workspacesOf(t, ann);
    const [card] = await t.db
      .insert(accounts)
      .values({ workspaceId: personal, name: 'Card', kind: 'card', currency: 'USD' })
      .returning();
    const entry = {
      workspaceId: personal,
      kind: 'expense' as const,
      amountMinor: 1250,
      currency: 'EUR',
      baseAmountMinor: 1250,
      occurredOn: '2026-10-01',
    };
    await t.db.insert(transactions).values({ ...entry, id: crypto.randomUUID(), accountId: null });
    await replay(t, '0013_entry_account_currency.sql');

    await t.db
      .insert(transactions)
      .values({ ...entry, id: crypto.randomUUID(), accountId: card!.id });
    await expect(replay(t, '0013_entry_account_currency.sql')).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/^1 live transactions or recurring rules differ/) },
    });
  });

  it('0014 opens an existing account on its creation day and bumps its revision (BR-40)', async () => {
    const { personal } = await workspacesOf(t, ann);
    const [card] = await t.db
      .insert(accounts)
      .values({
        workspaceId: personal,
        name: 'Card',
        kind: 'card',
        currency: 'EUR',
        createdAt: new Date('2025-03-04T23:30:00Z'),
      })
      .returning();
    const text = readFileSync(
      resolve(__dirname, '../drizzle/0014_account_opening_balance.sql'),
      'utf8',
    );
    await t.db.execute(sql.raw(text.split('--> statement-breakpoint').at(-1)!));

    const [after] = await t.db.select().from(accounts).where(eq(accounts.id, card!.id));
    expect(after).toMatchObject({ openingOn: '2025-03-04', openingBalanceMinor: 0 });
    expect(after!.revision).toBeGreaterThan(card!.revision);
  });
});
