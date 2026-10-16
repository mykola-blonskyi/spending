import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categories, workspaces } from '../src/database/schema';
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
});
