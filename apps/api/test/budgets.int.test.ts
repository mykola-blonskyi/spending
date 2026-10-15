import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { monthIn } from '../src/budgets/progress';
import { fxRates, transactions } from '../src/database/schema';
import { type FakeOidc, startFakeOidc } from './fake-oidc/server';
import {
  as,
  categoriesOf,
  createFamily,
  loginAs,
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

type Budget = {
  id: string;
  workspaceId: string;
  scope: string;
  categoryId: string;
  amountMinor: number;
  month: string;
  spentMinor: number;
  unconverted: { currency: string; amountMinor: number }[];
  status: string;
};

describe('budgets', () => {
  let provider: FakeOidc;
  let t: TestApp;
  let ann: Session;
  let bob: Session;
  let cid: Session;
  let annPersonal: string;
  let family: string;
  let annCategories: Record<string, string>;
  let familyCategories: Record<string, string>;

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
    family = await createFamily(t, ann, bob);
    annPersonal = (await workspacesOf(t, ann)).personal;
    annCategories = await categoriesOf(t, ann, annPersonal);
    familyCategories = await categoriesOf(t, ann, family);
  });
  afterAll(async () => {
    await t.app.close();
    await provider.close();
  });

  const json = async <T>(response: Response, status: number): Promise<T> => {
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
  const put = (s: Session, body: Record<string, unknown>) =>
    as(t, s, '/v1/budgets', { method: 'PUT', body });
  const list = async (s: Session, query = '') =>
    (await json<{ budgets: Budget[] }>(await as(t, s, `/v1/budgets${query}`), 200)).budgets;
  const errorCode = async (response: Response) =>
    ((await response.json()) as { error: { code: string } }).error.code;

  it('upserts one budget per category and deletes it', async () => {
    const created = await json<Budget>(
      await put(ann, {
        workspaceId: annPersonal,
        categoryId: annCategories.groceries,
        amountMinor: 30_000,
      }),
      200,
    );
    expect(created).toMatchObject({
      workspaceId: annPersonal,
      scope: 'personal',
      categoryId: annCategories.groceries,
      amountMinor: 30_000,
      spentMinor: 0,
      unconverted: [],
      status: 'ok',
    });
    const updated = await json<Budget>(
      await put(ann, {
        workspaceId: annPersonal,
        categoryId: annCategories.groceries,
        amountMinor: 45_000,
      }),
      200,
    );
    expect(updated).toMatchObject({ id: created.id, amountMinor: 45_000 });
    expect(await list(ann)).toEqual([updated]);

    expect((await as(t, ann, `/v1/budgets/${created.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await list(ann)).toEqual([]);
    expect((await as(t, ann, `/v1/budgets/${created.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('defaults to the current month in the user’s time zone', async () => {
    const zone = 'Pacific/Kiritimati';
    expect((await as(t, ann, '/v1/me', { method: 'PATCH', body: { timezone: zone } })).status).toBe(
      200,
    );
    await put(ann, { workspaceId: annPersonal, categoryId: annCategories.dining, amountMinor: 1 });
    const [budget] = await list(ann);
    expect(budget!.month).toBe(monthIn(new Date(), zone));
  });

  it('counts confirmed EUR expenses of the month and lists unconverted ones (BR-15, BR-22)', async () => {
    await t.db
      .insert(fxRates)
      .values({ date: '2026-10-30', currency: 'USD', ratePerEur: '1.25', source: 'ecb' });
    const groceries = annCategories.groceries;
    const rows = await pushNew(t, ann, [
      {
        workspaceId: annPersonal,
        categoryId: groceries,
        amountMinor: 5_000,
        occurredOn: '2026-10-01',
      },
      {
        workspaceId: annPersonal,
        categoryId: groceries,
        amountMinor: 2_500,
        currency: 'USD',
        occurredOn: '2026-10-31',
      },
      {
        workspaceId: annPersonal,
        categoryId: groceries,
        amountMinor: 90_000,
        currency: 'ARS',
        occurredOn: '2026-10-15',
      },
      {
        workspaceId: annPersonal,
        categoryId: groceries,
        amountMinor: 3_000,
        occurredOn: '2026-09-30',
      },
      {
        workspaceId: annPersonal,
        categoryId: groceries,
        amountMinor: 4_000,
        occurredOn: '2026-11-01',
      },
      { workspaceId: annPersonal, categoryId: annCategories.dining, amountMinor: 7_000 },
      {
        workspaceId: annPersonal,
        categoryId: groceries,
        amountMinor: 600,
        occurredOn: '2026-10-02',
      },
      {
        workspaceId: annPersonal,
        categoryId: groceries,
        amountMinor: 800,
        occurredOn: '2026-10-03',
      },
    ]);
    await pushDelete(t, ann, rows[6]!);
    await t.db
      .update(transactions)
      .set({ reviewStatus: 'pending_review' })
      .where(eq(transactions.id, rows[7]!.id));
    await put(ann, { workspaceId: annPersonal, categoryId: groceries, amountMinor: 8_000 });

    expect(await list(ann, '?month=2026-10')).toEqual([
      expect.objectContaining({
        month: '2026-10',
        spentMinor: 7_000,
        unconverted: [{ currency: 'ARS', amountMinor: 90_000 }],
        status: 'near',
      }),
    ]);
    expect(await list(ann, '?month=2026-09')).toEqual([
      expect.objectContaining({ spentMinor: 3_000, unconverted: [], status: 'ok' }),
    ]);
    expect(await list(ann, '?month=2026-11')).toEqual([
      expect.objectContaining({ spentMinor: 4_000, status: 'ok' }),
    ]);
    await put(ann, { workspaceId: annPersonal, categoryId: groceries, amountMinor: 6_999 });
    expect((await list(ann, '?month=2026-10'))[0]).toMatchObject({ status: 'over' });
  });

  it('rejects categories that are not active expense categories of the workspace', async () => {
    const reject = async (body: Record<string, unknown>, status: number, code: string) => {
      const response = await put(ann, body);
      expect(response.status).toBe(status);
      expect(await errorCode(response)).toBe(code);
    };
    await reject(
      { workspaceId: annPersonal, categoryId: annCategories.salary, amountMinor: 100 },
      422,
      'INVALID_CATEGORY',
    );
    await reject(
      { workspaceId: annPersonal, categoryId: familyCategories.groceries, amountMinor: 100 },
      422,
      'INVALID_CATEGORY',
    );
    await reject(
      { workspaceId: annPersonal, categoryId: crypto.randomUUID(), amountMinor: 100 },
      422,
      'INVALID_CATEGORY',
    );
    await as(t, ann, `/v1/categories/${annCategories.kids}`, {
      method: 'PATCH',
      body: { archived: true },
    });
    await reject(
      { workspaceId: annPersonal, categoryId: annCategories.kids, amountMinor: 100 },
      422,
      'INVALID_CATEGORY',
    );
    await reject(
      { workspaceId: annPersonal, categoryId: annCategories.groceries, amountMinor: 0 },
      400,
      'VALIDATION_FAILED',
    );
    await reject(
      { workspaceId: annPersonal, categoryId: annCategories.groceries, amountMinor: 1.5 },
      400,
      'VALIDATION_FAILED',
    );
    expect((await as(t, ann, '/v1/budgets?month=2026-13')).status).toBe(400);
  });

  it('keeps personal budgets private and shares family ones (BR-2)', async () => {
    const personal = await json<Budget>(
      await put(ann, {
        workspaceId: annPersonal,
        categoryId: annCategories.groceries,
        amountMinor: 10_000,
      }),
      200,
    );
    const shared = await json<Budget>(
      await put(bob, {
        workspaceId: family,
        categoryId: familyCategories.groceries,
        amountMinor: 20_000,
      }),
      200,
    );
    expect(shared.scope).toBe('family');
    await pushNew(t, ann, [
      { workspaceId: family, categoryId: familyCategories.groceries, amountMinor: 1_000 },
      { workspaceId: annPersonal, categoryId: annCategories.groceries, amountMinor: 9_000 },
    ]);
    await pushNew(t, bob, [
      { workspaceId: family, categoryId: familyCategories.groceries, amountMinor: 2_000 },
    ]);

    const annBudgets = await list(ann, '?month=2026-10');
    const bobBudgets = await list(bob, '?month=2026-10');
    expect(annBudgets.map((b) => b.id).sort()).toEqual([personal.id, shared.id].sort());
    expect(bobBudgets).toEqual([expect.objectContaining({ id: shared.id, spentMinor: 3_000 })]);
    expect(annBudgets.find((b) => b.id === shared.id)).toEqual(bobBudgets[0]);
    expect(await list(ann, `?workspaceId=${family}&month=2026-10`)).toEqual(bobBudgets);

    expect((await as(t, bob, `/v1/budgets?workspaceId=${annPersonal}`)).status).toBe(404);
    expect((await as(t, bob, `/v1/budgets/${personal.id}`, { method: 'DELETE' })).status).toBe(404);
    const foreign = await put(bob, {
      workspaceId: annPersonal,
      categoryId: annCategories.groceries,
      amountMinor: 1,
    });
    expect(foreign.status).toBe(404);
    expect(await list(cid)).toEqual([]);
    expect((await as(t, cid, `/v1/budgets/${shared.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await as(t, bob, `/v1/budgets/${shared.id}`, { method: 'DELETE' })).status).toBe(204);
  });
});
