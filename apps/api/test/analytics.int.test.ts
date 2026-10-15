import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fxRates, transactions } from '../src/database/schema';
import { type FakeOidc, startFakeOidc } from './fake-oidc/server';
import {
  as,
  categoriesOf,
  createFamily,
  loginAs,
  type PushedRow,
  pushDelete,
  pushNew,
  resetData,
  type Session,
  startTestApp,
  TEST_CLIENT,
  type TestApp,
  workspacesOf,
} from './harness';

const person = (name: string) => ({ sub: `sub-${name}`, email: `${name}@example.test`, name });
const people = [person('Ann'), person('Bob'), person('Cid')] as const;

type Summary = {
  period: { from: string; to: string };
  granularity: string;
  totals: { incomeMinor: number; expenseMinor: number; balanceMinor: number };
  unconverted: { currency: string; incomeMinor: number; expenseMinor: number }[];
  byCategory: {
    categoryId: string | null;
    name: string | null;
    amountMinor: number;
    share: number;
  }[];
  series: { bucket: string; incomeMinor: number; expenseMinor: number }[];
  previous?: {
    period: { from: string; to: string };
    totals: Summary['totals'];
    byCategory: Summary['byCategory'];
    deltas: Summary['totals'];
  };
};

describe('analytics', () => {
  let provider: FakeOidc;
  let t: TestApp;
  let ann: Session;
  let bob: Session;
  let cid: Session;
  let annGroceries: string;
  let familyGroceries: string;
  let annRow: PushedRow;

  beforeAll(async () => {
    provider = await startFakeOidc({ users: people, clients: [TEST_CLIENT] });
    t = await startTestApp({ OIDC_ISSUER: provider.issuer });
  });
  beforeEach(async () => {
    await resetData(t.db);
    [ann, bob, cid] = await Promise.all([
      loginAs(t, people[0].sub),
      loginAs(t, people[1].sub),
      loginAs(t, people[2].sub),
    ]);
    const family = await createFamily(t, ann, bob);
    const annPersonal = (await workspacesOf(t, ann)).personal;
    const bobPersonal = (await workspacesOf(t, bob)).personal;
    const annCategories = await categoriesOf(t, ann, annPersonal);
    annGroceries = annCategories.groceries!;
    familyGroceries = (await categoriesOf(t, ann, family)).groceries!;
    await t.db
      .insert(fxRates)
      .values({ date: '2026-10-01', currency: 'USD', ratePerEur: '1.25', source: 'ecb' });

    const mine = await pushNew(t, ann, [
      {
        workspaceId: annPersonal,
        categoryId: annGroceries,
        amountMinor: 5_000,
        occurredOn: '2026-10-02',
      },
      {
        workspaceId: annPersonal,
        categoryId: annGroceries,
        amountMinor: 2_500,
        currency: 'USD',
        occurredOn: '2026-10-05',
      },
      {
        workspaceId: annPersonal,
        kind: 'income',
        categoryId: annCategories.salary,
        amountMinor: 300_000,
        occurredOn: '2026-10-01',
      },
      { workspaceId: annPersonal, amountMinor: 90_000, currency: 'ARS', occurredOn: '2026-10-03' },
      { workspaceId: annPersonal, amountMinor: 7_777, occurredOn: '2026-10-04' },
      { workspaceId: annPersonal, amountMinor: 6_666, occurredOn: '2026-10-04' },
      {
        workspaceId: annPersonal,
        categoryId: annGroceries,
        amountMinor: 3_000,
        occurredOn: '2026-09-15',
      },
      {
        workspaceId: family,
        categoryId: familyGroceries,
        amountMinor: 4_000,
        occurredOn: '2026-10-10',
      },
    ]);
    annRow = mine[0]!;
    await pushDelete(t, ann, mine[4]!);
    await t.db
      .update(transactions)
      .set({ reviewStatus: 'pending_review' })
      .where(eq(transactions.id, mine[5]!.id));
    await pushNew(t, bob, [
      {
        workspaceId: family,
        categoryId: familyGroceries,
        amountMinor: 1_000,
        occurredOn: '2026-10-11',
      },
      { workspaceId: bobPersonal, amountMinor: 99_999, occurredOn: '2026-10-02' },
    ]);
  });
  afterAll(async () => {
    await t.app.close();
    await provider.close();
  });

  const summary = async (s: Session, query: string) => {
    const response = await as(t, s, `/v1/analytics/summary?from=2026-10-01&to=2026-10-31${query}`);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as Summary;
  };

  it('matches the hand-computed fixture across currencies (BR-15)', async () => {
    const all = await summary(ann, '');
    expect(all.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(all.granularity).toBe('day');
    expect(all.totals).toEqual({
      incomeMinor: 300_000,
      expenseMinor: 12_000,
      balanceMinor: 288_000,
    });
    expect(all.unconverted).toEqual([{ currency: 'ARS', incomeMinor: 0, expenseMinor: 90_000 }]);
    expect(all.byCategory.map((c) => [c.categoryId, c.name, c.amountMinor, c.share])).toEqual([
      [annGroceries, 'Groceries', 7_000, 0.5833],
      [familyGroceries, 'Groceries', 5_000, 0.4167],
      [expect.any(String), 'Salary', 300_000, 1],
    ]);
    expect(all.series).toHaveLength(31);
    expect(all.series[1]).toEqual({ bucket: '2026-10-02', incomeMinor: 0, expenseMinor: 5_000 });
    expect(all.series.reduce((sum, b) => sum + b.expenseMinor, 0)).toBe(12_000);

    expect(all.previous).toEqual({
      period: { from: '2026-08-31', to: '2026-09-30' },
      totals: { incomeMinor: 0, expenseMinor: 3_000, balanceMinor: -3_000 },
      byCategory: [
        expect.objectContaining({ categoryId: annGroceries, amountMinor: 3_000, share: 1 }),
      ],
      deltas: { incomeMinor: 300_000, expenseMinor: 9_000, balanceMinor: 291_000 },
    });
    expect((await summary(ann, '&compare=none')).previous).toBeUndefined();
  });

  it('filters by scope and isolates personal data (BR-2)', async () => {
    expect((await summary(ann, '&scope=personal')).totals).toEqual({
      incomeMinor: 300_000,
      expenseMinor: 7_000,
      balanceMinor: 293_000,
    });
    const annFamily = await summary(ann, '&scope=family');
    const bobFamily = await summary(bob, '&scope=family');
    expect(annFamily.totals.expenseMinor).toBe(5_000);
    expect(bobFamily).toEqual(annFamily);
    expect((await summary(bob, '')).totals.expenseMinor).toBe(104_999);
    expect((await summary(cid, '&scope=family')).totals).toEqual({
      incomeMinor: 0,
      expenseMinor: 0,
      balanceMinor: 0,
    });
    expect((await summary(cid, '')).byCategory).toEqual([]);
  });

  it('counts the server row only while a conflict is open (BR-19)', async () => {
    const edit = (baseVersion: number, amountMinor: number) =>
      as(t, ann, '/v1/sync/push', {
        method: 'POST',
        body: {
          mutations: [
            {
              mutationId: crypto.randomUUID(),
              type: 'transaction.upsert',
              baseVersion,
              transaction: {
                id: annRow.id,
                workspaceId: annRow.workspaceId,
                kind: 'expense',
                amountMinor,
                currency: 'EUR',
                occurredOn: '2026-10-02',
                accountId: null,
                categoryId: annGroceries,
                description: '',
                note: '',
              },
            },
          ],
        },
      });
    await edit(1, 6_000);
    const stale = (await (await edit(1, 60_000)).json()) as { results: { status: string }[] };
    expect(stale.results[0]!.status).toBe('conflict');
    expect((await summary(ann, '&scope=personal')).totals.expenseMinor).toBe(8_000);
  });

  it('validates the period', async () => {
    const status = async (query: string) =>
      (await as(t, ann, `/v1/analytics/summary?${query}`)).status;
    expect(await status('from=2026-10-31&to=2026-10-01')).toBe(400);
    expect(await status('from=2026-10-01')).toBe(400);
    expect(await status('from=2026-02-30&to=2026-03-01')).toBe(400);
    expect(await status('from=2000-01-01&to=2026-01-01')).toBe(400);
    expect(await status('from=2026-01-01&to=2026-12-31&scope=mine')).toBe(400);
    expect(await status('from=2026-01-01&to=2026-12-31')).toBe(200);
  });
});
