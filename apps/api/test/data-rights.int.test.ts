import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  budgets,
  categories,
  categoryRules,
  fxRates,
  importBatches,
  memberships,
  recurringRules,
  sessions,
  syncConflicts,
  syncMutations,
  transactions,
  users,
  workspaces,
} from '../src/database/schema';
import { type FakeOidc, startFakeOidc } from './fake-oidc/server';
import {
  api,
  as,
  loginAs,
  resetData,
  type Session,
  SESSION_COOKIE,
  startTestApp,
  TEST_CLIENT,
  type TestApp,
} from './harness';

const person = (name: string) => ({ sub: `sub-${name}`, email: `${name}@example.test`, name });
const people = [person('Ann'), person('Bob'), person('Cat')] as const;

type View = {
  id: string;
  workspaceId: string;
  accountId: string | null;
  description: string;
  reviewStatus: string;
  author: { userId: string | null; displayName: string | null };
};
type Export = {
  exportedAt: string;
  user: { id: string; email: string };
  workspaces: { id: string; kind: string; role: string; members: { userId: string }[] }[];
  accounts: { id: string; workspaceId: string }[];
  categories: { id: string; workspaceId: string }[];
  transactions: View[];
  budgets: { workspaceId: string }[];
  recurringRules: { workspaceId: string; accountId: string | null }[];
  importBatches: { workspaceId: string }[];
  categoryRules: { workspaceId: string }[];
  conflicts: { id: string; transactionId: string; local: unknown; createdAt: string }[];
};

describe('data rights', () => {
  let provider: FakeOidc;
  let t: TestApp;
  let ann: Session;
  let bob: Session;
  let annPersonal: string;
  let bobPersonal: string;
  let family: string;

  beforeAll(async () => {
    provider = await startFakeOidc({ users: people, clients: [TEST_CLIENT] });
    t = await startTestApp({ OIDC_ISSUER: provider.issuer });
  });
  beforeEach(async () => {
    await resetData(t.db);
    [ann, bob] = await Promise.all([loginAs(t, people[0].sub), loginAs(t, people[1].sub)]);
    family = (await json<{ id: string }>(await createFamily(ann), 201)).id;
    const { url } = await json<{ url: string }>(
      await as(t, ann, '/v1/family/invitations', { method: 'POST', body: {} }),
      201,
    );
    await json(
      await as(t, bob, `/v1/invitations/${url.split('/invite/')[1]}/accept`, { method: 'POST' }),
      200,
    );
    [annPersonal, bobPersonal] = await Promise.all([personalOf(ann), personalOf(bob)]);
  });
  afterAll(async () => {
    await t.app.close();
    await provider.close();
  });

  const json = async <T>(response: Response, status: number): Promise<T> => {
    expect(response.status).toBe(status);
    return (await response.json()) as T;
  };
  const errorCode = async (response: Response) =>
    ((await response.json()) as { error: { code: string } }).error.code;
  const createFamily = (s: Session) =>
    as(t, s, '/v1/family', { method: 'POST', body: { name: 'Home' } });
  const personalOf = async (s: Session) =>
    (
      await json<{ workspaces: { id: string; kind: string }[] }>(
        await as(t, s, '/v1/workspaces'),
        200,
      )
    ).workspaces.find((w) => w.kind === 'personal')!.id;
  const account = async (s: Session, workspaceId: string, name: string) =>
    (
      await json<{ id: string }>(
        await as(t, s, '/v1/accounts', {
          method: 'POST',
          body: { workspaceId, name, kind: 'card', currency: 'EUR' },
        }),
        201,
      )
    ).id;
  const categoryOf = async (workspaceId: string, systemKey: string) =>
    (
      await t.db
        .select({ id: categories.id, systemKey: categories.systemKey })
        .from(categories)
        .where(eq(categories.workspaceId, workspaceId))
    ).find((c) => c.systemKey === systemKey)!.id;

  async function push(s: Session, ...rows: Record<string, unknown>[]): Promise<View[]> {
    const mutations = rows.map((transaction) => ({
      mutationId: crypto.randomUUID(),
      type: 'transaction.upsert',
      baseVersion: null,
      transaction: {
        id: crypto.randomUUID(),
        workspaceId: annPersonal,
        kind: 'expense',
        amountMinor: 1000,
        currency: 'EUR',
        occurredOn: '2026-10-01',
        accountId: null,
        categoryId: null,
        description: '',
        note: '',
        ...transaction,
      },
    }));
    const { results } = await json<{ results: { status: string; transaction: View }[] }>(
      await as(t, s, '/v1/sync/push', { method: 'POST', body: { mutations } }),
      200,
    );
    expect(results.map((r) => r.status)).toEqual(rows.map(() => 'applied'));
    return results.map((r) => r.transaction);
  }

  const exportOf = (s: Session, format?: string) =>
    as(t, s, `/v1/me/export${format ? `?format=${format}` : ''}`);
  const exportJson = async (s: Session) => json<Export>(await exportOf(s), 200);
  const deleteMe = (s: Session, confirmation = 'DELETE MY DATA') =>
    as(t, s, '/v1/me', { method: 'DELETE', body: { confirmation } });

  describe('export', () => {
    it('contains everything the actor sees and nothing of another member (BR-2, BR-3, BR-31)', async () => {
      const annCard = await account(ann, annPersonal, 'Ann card');
      const joint = await account(ann, family, 'Joint');
      const bobCard = await account(bob, bobPersonal, 'Bob card');
      const [annRow, annFamilyRow, deletedRow] = await push(
        ann,
        { description: 'ann private', accountId: annCard },
        { description: 'ann family', workspaceId: family, accountId: annCard },
        { description: 'gone', workspaceId: family },
      );
      const [bobFamilyRow, bobRow] = await push(
        bob,
        { description: 'joint family', workspaceId: family, accountId: joint },
        { description: 'bob private', workspaceId: bobPersonal, accountId: bobCard },
      );
      await as(t, ann, '/v1/sync/push', {
        method: 'POST',
        body: {
          mutations: [
            {
              mutationId: crypto.randomUUID(),
              type: 'transaction.delete',
              transactionId: deletedRow!.id,
              baseVersion: 1,
            },
          ],
        },
      });
      const pendingId = crypto.randomUUID();
      await t.db.insert(transactions).values({
        id: pendingId,
        workspaceId: annPersonal,
        createdBy: ann.userId,
        kind: 'expense',
        amountMinor: 500,
        currency: 'EUR',
        baseAmountMinor: 500,
        occurredOn: '2026-10-02',
        source: 'import',
        reviewStatus: 'pending_review',
      });
      await t.db.insert(budgets).values([
        {
          workspaceId: annPersonal,
          categoryId: await categoryOf(annPersonal, 'groceries'),
          amountMinor: 100,
        },
        {
          workspaceId: family,
          categoryId: await categoryOf(family, 'groceries'),
          amountMinor: 200,
        },
      ]);
      await t.db.insert(recurringRules).values({
        workspaceId: family,
        createdBy: ann.userId,
        kind: 'expense',
        amountMinor: 900,
        currency: 'EUR',
        accountId: annCard,
        frequency: 'monthly',
        startsOn: '2026-10-01',
        timezone: 'Europe/Madrid',
      });
      await t.db.insert(importBatches).values({
        workspaceId: annPersonal,
        userId: ann.userId,
        accountId: annCard,
        fileName: 'statement.csv',
        mapping: {},
        rowCount: 1,
        importedCount: 1,
        duplicateCount: 0,
        rejectedCount: 0,
        rejected: [],
      });
      await t.db.insert(categoryRules).values({
        workspaceId: annPersonal,
        merchantKey: 'ann-shop',
        categoryId: await categoryOf(annPersonal, 'groceries'),
      });

      const response = await exportOf(ann);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^application\/json/);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const annExport = (await response.json()) as Export;
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="spending-export-${annExport.exportedAt.slice(0, 10)}.json"`,
      );
      expect(annExport.user).toMatchObject({ id: ann.userId, email: 'Ann@example.test' });
      expect(annExport.workspaces.map((w) => [w.kind, w.role, w.members.length])).toEqual([
        ['personal', 'owner', 1],
        ['family', 'owner', 2],
      ]);
      expect(annExport.accounts.map((a) => a.id).sort()).toEqual([annCard, joint].sort());
      expect(new Set(annExport.categories.map((c) => c.workspaceId))).toEqual(
        new Set([annPersonal, family]),
      );
      expect(annExport.transactions.map((r) => r.description).sort()).toEqual(
        ['ann family', 'ann private', 'joint family', ''].sort(),
      );
      expect(annExport.transactions.find((r) => r.id === pendingId)).toMatchObject({
        reviewStatus: 'pending_review',
      });
      expect(annExport.transactions.find((r) => r.id === annFamilyRow!.id)!.accountId).toBe(
        annCard,
      );
      expect(annExport.budgets).toHaveLength(2);
      expect(annExport.recurringRules).toEqual([
        expect.objectContaining({ workspaceId: family, accountId: annCard }),
      ]);
      expect(annExport.importBatches).toHaveLength(1);
      expect(annExport.categoryRules).toHaveLength(1);

      const bobExport = await exportJson(bob);
      const leaked = JSON.stringify(bobExport);
      for (const secret of [
        annPersonal,
        annCard,
        annRow!.id,
        pendingId,
        'ann private',
        'ann-shop',
      ]) {
        expect(leaked).not.toContain(secret);
      }
      expect(bobExport.accounts.map((a) => a.id).sort()).toEqual([joint, bobCard].sort());
      expect(bobExport.transactions.map((r) => r.description).sort()).toEqual(
        ['ann family', 'bob private', 'joint family'].sort(),
      );
      expect(bobExport.transactions.find((r) => r.id === annFamilyRow!.id)).toMatchObject({
        accountId: null,
        author: { userId: ann.userId, displayName: 'Ann' },
      });
      expect(bobExport.transactions.find((r) => r.id === bobFamilyRow!.id)!.accountId).toBe(joint);
      expect(bobExport.transactions.find((r) => r.id === bobRow!.id)!.accountId).toBe(bobCard);
      expect(bobExport.budgets.map((b) => b.workspaceId)).toEqual([family]);
      expect(bobExport.recurringRules).toEqual([
        expect.objectContaining({ workspaceId: family, accountId: null }),
      ]);
      expect(bobExport.importBatches).toEqual([]);
      expect(bobExport.categoryRules).toEqual([]);
    });

    it("includes the actor's own open conflict versions, and nobody else's", async () => {
      const [row] = await push(ann, { description: 'shared', workspaceId: family });
      const conflict = { transactionId: row!.id, baseVersion: 1, serverVersion: 1 };
      const [open] = await t.db
        .insert(syncConflicts)
        .values([
          { ...conflict, userId: ann.userId, local: { deleted: true } },
          { ...conflict, userId: bob.userId, local: { deleted: true } },
          {
            ...conflict,
            userId: ann.userId,
            local: { deleted: true },
            status: 'resolved',
            resolution: 'server',
            resolvedAt: new Date(),
          },
        ])
        .returning();
      expect((await exportJson(ann)).conflicts).toEqual([
        {
          id: open!.id,
          transactionId: row!.id,
          local: { deleted: true },
          createdAt: open!.createdAt.toISOString(),
        },
      ]);
      expect((await exportJson(bob)).conflicts.map((c) => c.id)).not.toContain(open!.id);
    });

    it('writes confirmed transactions as RFC 4180 CSV with exact amounts, safe from formulas', async () => {
      await t.db.insert(fxRates).values([
        { date: '2026-10-01', currency: 'JPY', ratePerEur: '160.5', source: 'ecb' },
        { date: '2026-10-01', currency: 'KWD', ratePerEur: '0.33', source: 'ecb' },
      ]);
      const card = await account(ann, annPersonal, 'Visa, "gold"');
      await push(
        ann,
        { currency: 'JPY', amountMinor: 12345, description: '=HYPERLINK("http://x.test")' },
        {
          currency: 'KWD',
          amountMinor: 1234,
          kind: 'income',
          description: '-2',
          note: 'a,b\n"c"',
          accountId: card,
          categoryId: await categoryOf(annPersonal, 'salary'),
          occurredOn: '2026-10-02',
        },
        { amountMinor: 5, description: '@cmd', note: '\tx', occurredOn: '2026-10-03' },
        { amountMinor: 150, description: '+1', workspaceId: family, occurredOn: '2026-10-04' },
      );
      await t.db.insert(transactions).values({
        id: crypto.randomUUID(),
        workspaceId: annPersonal,
        createdBy: ann.userId,
        kind: 'expense',
        amountMinor: 999,
        currency: 'EUR',
        baseAmountMinor: 999,
        occurredOn: '2026-10-05',
        description: 'pending',
        reviewStatus: 'pending_review',
      });

      const response = await exportOf(ann, 'csv');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      expect(response.headers.get('content-disposition')).toMatch(
        /^attachment; filename="spending-export-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(response.headers.get('cache-control')).toBe('no-store');
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const text = new TextDecoder().decode(bytes.slice(3));
      expect(text.split('\r\n')).toEqual([
        'date,kind,amount,currency,eur_amount,fx_rate,fx_rate_date,scope,workspace,account,category,description,note,source,author',
        `2026-10-01,expense,12345,JPY,76.92,160.5000000000,2026-10-01,personal,,,,"'=HYPERLINK(""http://x.test"")",,manual,Ann`,
        `2026-10-02,income,1.234,KWD,3.74,0.3300000000,2026-10-01,personal,,"Visa, ""gold""",salary,'-2,"a,b\n""c""",manual,Ann`,
        `2026-10-03,expense,0.05,EUR,0.05,,,personal,,,,'@cmd,'\tx,manual,Ann`,
        `2026-10-04,expense,1.50,EUR,1.50,,,family,Home,,,'+1,,manual,Ann`,
        '',
      ]);
    });

    it('rejects an unknown format', async () => {
      expect(await errorCode(await exportOf(ann, 'xml'))).toBe('VALIDATION_FAILED');
    });
  });

  describe('deletion', () => {
    it('requires the exact confirmation phrase', async () => {
      const response = await deleteMe(bob, 'delete my data');
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe('CONFIRMATION_MISMATCH');
      expect(await t.db.select().from(users).where(eq(users.id, bob.userId))).toHaveLength(1);
    });

    it('refuses a family owner with other members (BR-32)', async () => {
      const response = await deleteMe(ann);
      expect(response.status).toBe(409);
      expect(await errorCode(response)).toBe('FAMILY_OWNER_MUST_TRANSFER');
      expect(await t.db.select().from(users).where(eq(users.id, ann.userId))).toHaveLength(1);
    });

    it('hard-deletes a member, keeps their family rows as a former member, ends sessions', async () => {
      const bobCard = await account(bob, bobPersonal, 'Bob card');
      const [familyRow, privateRow] = await push(
        bob,
        { description: 'bob family', workspaceId: family, accountId: bobCard },
        { description: 'bob private', workspaceId: bobPersonal, accountId: bobCard },
      );
      await t.db.insert(syncConflicts).values({
        transactionId: familyRow!.id,
        userId: bob.userId,
        baseVersion: 1,
        serverVersion: 1,
        local: {},
      });
      const secondBob = await loginAs(t, people[1].sub);
      const revocationsBefore = provider.revocations;

      const response = await deleteMe(bob);
      expect(response.status).toBe(204);
      expect(response.headers.getSetCookie().join(';')).toContain(`${SESSION_COOKIE}=;`);
      expect(provider.revocations - revocationsBefore).toBe(2);

      for (const s of [bob, secondBob]) {
        expect(await errorCode(await api(t, '/v1/auth/session', { cookie: s.cookie }))).toBe(
          'AUTH_REQUIRED',
        );
      }
      expect(await t.db.select().from(users).where(eq(users.id, bob.userId))).toEqual([]);
      expect(await t.db.select().from(sessions).where(eq(sessions.userId, bob.userId))).toEqual([]);
      expect(
        await t.db.select().from(memberships).where(eq(memberships.userId, bob.userId)),
      ).toEqual([]);
      expect(
        await t.db.select().from(syncMutations).where(eq(syncMutations.userId, bob.userId)),
      ).toEqual([]);
      expect(await t.db.select().from(syncConflicts)).toEqual([]);
      expect(await t.db.select().from(workspaces).where(eq(workspaces.id, bobPersonal))).toEqual(
        [],
      );
      expect(
        await t.db.select().from(transactions).where(eq(transactions.id, privateRow!.id)),
      ).toEqual([]);

      const { transactions: seen } = await json<{ transactions: View[] }>(
        await as(t, ann, '/v1/transactions'),
        200,
      );
      expect(seen.find((r) => r.id === familyRow!.id)).toMatchObject({
        description: 'bob family',
        accountId: null,
        author: { userId: null, displayName: null },
      });
      const annWorkspaces = await json<{ workspaces: { members: unknown[] }[] }>(
        await as(t, ann, '/v1/workspaces'),
        200,
      );
      expect(annWorkspaces.workspaces[1]!.members).toHaveLength(1);

      const reborn = await loginAs(t, people[1].sub);
      expect(reborn.userId).not.toBe(bob.userId);
      const fresh = await exportJson(reborn);
      expect(fresh.workspaces.map((w) => w.kind)).toEqual(['personal']);
      expect(fresh.workspaces[0]!.id).not.toBe(bobPersonal);
      expect(fresh.accounts).toEqual([]);
      expect(fresh.transactions).toEqual([]);
      expect(fresh.categories).toHaveLength(20);
    });

    it('deletes a sole owner’s family first (BR-11), then the owner', async () => {
      const cat = await loginAs(t, people[2].sub);
      const catFamily = (await json<{ id: string }>(await createFamily(cat), 201)).id;
      const catPersonal = await personalOf(cat);
      await push(
        cat,
        { description: 'cat family', workspaceId: catFamily },
        { description: 'cat private', workspaceId: catPersonal },
      );

      expect((await deleteMe(cat)).status).toBe(204);
      expect(await t.db.select().from(workspaces).where(eq(workspaces.id, catFamily))).toEqual([]);
      expect(
        await t.db.select().from(workspaces).where(eq(workspaces.ownerId, cat.userId)),
      ).toEqual([]);
      expect(
        (await t.db.select().from(transactions)).filter((r) => r.description.startsWith('cat')),
      ).toEqual([]);
    });

    it('lets the remaining owner delete after the last member is gone', async () => {
      const [bobRow] = await push(bob, { description: 'bob family', workspaceId: family });
      expect((await deleteMe(bob)).status).toBe(204);
      expect((await deleteMe(ann)).status).toBe(204);
      expect(await t.db.select().from(workspaces)).toEqual([]);
      expect(await t.db.select().from(transactions).where(eq(transactions.id, bobRow!.id))).toEqual(
        [],
      );
    });
  });
});
