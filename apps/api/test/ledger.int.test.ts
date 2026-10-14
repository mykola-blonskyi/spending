import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '../src/common/dates';
import { fxRates, transactions } from '../src/database/schema';
import { FX_RATE_SOURCE, type FxRateSource } from '../src/ledger/fx/fx-source';
import { FxService } from '../src/ledger/fx/fx.service';
import { type FakeOidc, startFakeOidc } from './fake-oidc/server';
import {
  as,
  loginAs,
  resetData,
  type Session,
  startTestApp,
  TEST_CLIENT,
  type TestApp,
} from './harness';

const person = (name: string) => ({ sub: `sub-${name}`, email: `${name}@example.test`, name });
const people = [person('Ann'), person('Bob')] as const;

type View = Record<string, unknown> & { id: string; version: number; revision: number };

describe('ledger', () => {
  let provider: FakeOidc;
  let t: TestApp;
  let ann: Session;
  let bob: Session;
  let annPersonal: string;
  let family: string;

  beforeAll(async () => {
    provider = await startFakeOidc({ users: people, clients: [TEST_CLIENT] });
    t = await startTestApp({ OIDC_ISSUER: provider.issuer });
  });
  beforeEach(async () => {
    await resetData(t.db);
    vi.restoreAllMocks();
    [ann, bob] = await Promise.all([loginAs(t, people[0].sub), loginAs(t, people[1].sub)]);
    family = (
      (await (
        await as(t, ann, '/v1/family', { method: 'POST', body: { name: 'Home' } })
      ).json()) as {
        id: string;
      }
    ).id;
    const { url } = (await (
      await as(t, ann, '/v1/family/invitations', { method: 'POST', body: {} })
    ).json()) as { url: string };
    await as(t, bob, `/v1/invitations/${url.split('/invite/')[1]}/accept`, { method: 'POST' });
    const { workspaces } = (await (await as(t, ann, '/v1/workspaces')).json()) as {
      workspaces: { id: string; kind: string }[];
    };
    annPersonal = workspaces.find((w) => w.kind === 'personal')!.id;
  });
  afterAll(async () => {
    await t.app.close();
    await provider.close();
  });

  const json = async <T>(response: Response, status: number): Promise<T> => {
    expect(response.status).toBe(status);
    return (await response.json()) as T;
  };

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

  describe('accounts and categories', () => {
    it('creates, renames and archives accounts with unique names', async () => {
      const created = await json<{ id: string; revision: number }>(
        await as(t, ann, '/v1/accounts', {
          method: 'POST',
          body: { workspaceId: annPersonal, name: ' Visa ', kind: 'card', currency: 'USD' },
        }),
        201,
      );
      expect(created).toMatchObject({ name: 'Visa', currency: 'USD', archivedAt: null });
      const duplicate = await as(t, ann, '/v1/accounts', {
        method: 'POST',
        body: { workspaceId: annPersonal, name: 'Visa', kind: 'card', currency: 'EUR' },
      });
      expect(duplicate.status).toBe(409);
      expect(((await duplicate.json()) as { error: { code: string } }).error.code).toBe(
        'NAME_TAKEN',
      );
      expect(
        (
          await as(t, ann, '/v1/accounts', {
            method: 'POST',
            body: { workspaceId: annPersonal, name: 'Visa', kind: 'cash', currency: 'EUR' },
          })
        ).status,
      ).toBe(201);

      const archived = await json<{ archivedAt: string; revision: number; name: string }>(
        await as(t, ann, `/v1/accounts/${created.id}`, {
          method: 'PATCH',
          body: { name: 'Old Visa', archived: true },
        }),
        200,
      );
      expect(archived.archivedAt).toEqual(expect.any(String));
      expect(archived.revision).toBeGreaterThan(created.revision);
      const restored = await json<{ archivedAt: null }>(
        await as(t, ann, `/v1/accounts/${created.id}`, {
          method: 'PATCH',
          body: { archived: false },
        }),
        200,
      );
      expect(restored.archivedAt).toBeNull();

      for (const body of [
        { workspaceId: annPersonal, name: 'X', kind: 'card', currency: 'XYZ' },
        { workspaceId: annPersonal, name: '', kind: 'card', currency: 'EUR' },
        { workspaceId: annPersonal, name: 'X', kind: 'crypto', currency: 'EUR' },
      ]) {
        expect((await as(t, ann, '/v1/accounts', { method: 'POST', body })).status).toBe(400);
      }
    });

    it('keeps personal accounts and categories private (BR-2)', async () => {
      const { id } = await json<{ id: string }>(
        await as(t, ann, '/v1/accounts', {
          method: 'POST',
          body: { workspaceId: annPersonal, name: 'Visa', kind: 'card', currency: 'EUR' },
        }),
        201,
      );
      const { accounts } = await json<{ accounts: { workspaceId: string }[] }>(
        await as(t, bob, '/v1/accounts'),
        200,
      );
      expect(accounts.map((a) => a.workspaceId)).not.toContain(annPersonal);
      expect((await as(t, bob, `/v1/accounts?workspaceId=${annPersonal}`)).status).toBe(404);
      expect(
        (await as(t, bob, `/v1/accounts/${id}`, { method: 'PATCH', body: { name: 'Mine' } }))
          .status,
      ).toBe(404);
      expect(
        (
          await as(t, bob, '/v1/accounts', {
            method: 'POST',
            body: { workspaceId: annPersonal, name: 'Sneaky', kind: 'cash', currency: 'EUR' },
          })
        ).status,
      ).toBe(404);
      const { categories } = await json<{ categories: { id: string; workspaceId: string }[] }>(
        await as(t, bob, '/v1/categories'),
        200,
      );
      expect(categories.map((c) => c.workspaceId)).not.toContain(annPersonal);
      const annCategory = (
        await json<{ categories: { id: string }[] }>(
          await as(t, ann, `/v1/categories?workspaceId=${annPersonal}`),
          200,
        )
      ).categories[0]!;
      expect(
        (
          await as(t, bob, `/v1/categories/${annCategory.id}`, {
            method: 'PATCH',
            body: { icon: 'x' },
          })
        ).status,
      ).toBe(404);
    });

    it('creates and edits categories', async () => {
      const taken = await as(t, ann, '/v1/categories', {
        method: 'POST',
        body: {
          workspaceId: family,
          name: 'Groceries',
          kind: 'expense',
          color: '#00ff00',
          icon: 'apple',
        },
      });
      expect(taken.status).toBe(409);
      const created = await json<{ id: string; color: string; systemKey: null }>(
        await as(t, bob, '/v1/categories', {
          method: 'POST',
          body: {
            workspaceId: family,
            name: 'Groceries',
            kind: 'income',
            color: '#00FF00',
            icon: 'apple',
          },
        }),
        201,
      );
      expect(created).toMatchObject({ color: '#00ff00', systemKey: null });
      for (const patch of [{ color: 'green' }, { icon: 'Apple Icon' }, { kind: 'expense' }]) {
        expect(
          (await as(t, ann, `/v1/categories/${created.id}`, { method: 'PATCH', body: patch }))
            .status,
        ).toBe(400);
      }
      const edited = await json<{ name: string; archivedAt: string }>(
        await as(t, ann, `/v1/categories/${created.id}`, {
          method: 'PATCH',
          body: { name: 'Market', icon: 'store', archived: true },
        }),
        200,
      );
      expect(edited).toMatchObject({
        name: 'Market',
        icon: 'store',
        archivedAt: expect.any(String),
      });
    });
  });

  describe('GET /v1/transactions', () => {
    const list = async (s: Session, query = '') =>
      json<{ transactions: View[]; nextCursor: string | null }>(
        await as(t, s, `/v1/transactions${query}`),
        200,
      );

    it('filters, searches literally and pages by keyset', async () => {
      const [percent, underscore, plain] = await push(
        ann,
        { description: '100% juice', occurredOn: '2026-10-03' },
        { description: 'a_b', occurredOn: '2026-10-02', kind: 'income' },
        { description: 'abb', note: 'Juice bar', occurredOn: '2026-10-02', currency: 'USD' },
      );
      const [shared] = await push(bob, {
        workspaceId: family,
        description: 'Rent',
        occurredOn: '2026-09-01',
      });
      const ids = async (query: string) => (await list(ann, query)).transactions.map((r) => r.id);

      expect(await ids('?q=%25')).toEqual([percent!.id]);
      expect(await ids('?q=_')).toEqual([underscore!.id]);
      expect(await ids('?q=juice')).toEqual([percent!.id, plain!.id]);
      expect(await ids('?kind=income')).toEqual([underscore!.id]);
      expect(await ids('?currency=USD')).toEqual([plain!.id]);
      expect(await ids('?scope=family')).toEqual([shared!.id]);
      expect(await ids(`?workspaceId=${family}`)).toEqual([shared!.id]);
      expect(await ids('?from=2026-10-02&to=2026-10-02')).toHaveLength(2);
      expect((await as(t, ann, '/v1/transactions?limit=201')).status).toBe(400);
      expect((await as(t, ann, '/v1/transactions?cursor=nonsense')).status).toBe(400);
      const forged = Buffer.from(
        JSON.stringify(['2026-10-01', '2026-02-30T00:00:00.000000Z', crypto.randomUUID()]),
      ).toString('base64url');
      const forgedResponse = await as(t, ann, `/v1/transactions?cursor=${forged}`);
      expect(forgedResponse.status).toBe(400);
      expect(((await forgedResponse.json()) as { error: { code: string } }).error.code).toBe(
        'VALIDATION_FAILED',
      );
      expect((await as(t, ann, '/v1/transactions?unknown=1')).status).toBe(400);
      expect((await as(t, bob, `/v1/transactions?workspaceId=${annPersonal}`)).status).toBe(404);

      const all = await ids('');
      expect(all).toHaveLength(4);
      const paged: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await list(ann, `?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
        paged.push(...page.transactions.map((r) => r.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(paged).toEqual(all);
    });

    it("excludes tombstones, other people's personal rows and hidden accounts", async () => {
      const { id: annCard } = await json<{ id: string }>(
        await as(t, ann, '/v1/accounts', {
          method: 'POST',
          body: { workspaceId: annPersonal, name: 'Visa', kind: 'card', currency: 'EUR' },
        }),
        201,
      );
      const [privateRow, sharedRow, gone] = await push(
        ann,
        {},
        { workspaceId: family, accountId: annCard },
        {},
      );
      await as(t, ann, '/v1/sync/push', {
        method: 'POST',
        body: {
          mutations: [
            {
              mutationId: crypto.randomUUID(),
              type: 'transaction.delete',
              transactionId: gone!.id,
              baseVersion: 1,
            },
          ],
        },
      });
      const bobView = await list(bob);
      expect(bobView.transactions.map((r) => r.id)).toEqual([sharedRow!.id]);
      expect(bobView.transactions[0]!.accountId).toBeNull();
      expect((await list(bob, `?accountId=${annCard}`)).transactions).toEqual([]);
      expect((await list(ann, `?accountId=${annCard}`)).transactions.map((r) => r.id)).toEqual([
        sharedRow!.id,
      ]);
      expect((await list(ann)).transactions.map((r) => r.id).sort()).toEqual(
        [privateRow!.id, sharedRow!.id].sort(),
      );

      await t.db
        .update(transactions)
        .set({ reviewStatus: 'pending_review' })
        .where(eq(transactions.id, privateRow!.id));
      await t.db
        .update(transactions)
        .set({ reviewStatus: 'pending_review' })
        .where(eq(transactions.id, sharedRow!.id));
      expect((await list(ann)).transactions).toEqual([]);
      expect(
        (await list(ann, '?reviewStatus=pending_review')).transactions.map((r) => r.id),
      ).toEqual([privateRow!.id]);
      expect((await list(bob, '?reviewStatus=pending_review')).transactions).toEqual([]);
    });
  });

  describe('FX', () => {
    it('converts on write from the rate of the day or up to seven days before', async () => {
      await t.db.insert(fxRates).values([
        { date: '2026-10-01', currency: 'USD', ratePerEur: '1.25', source: 'ecb' },
        { date: '2026-09-20', currency: 'GBP', ratePerEur: '0.8', source: 'ecb' },
      ]);
      const [sameDay, weekLater, tooLate, gbp] = await push(
        ann,
        { currency: 'USD', amountMinor: 1250, occurredOn: '2026-10-01' },
        { currency: 'USD', amountMinor: 1250, occurredOn: '2026-10-08' },
        { currency: 'USD', amountMinor: 1250, occurredOn: '2026-10-09' },
        { currency: 'GBP', amountMinor: 800, occurredOn: '2026-10-01' },
      );
      expect(sameDay).toMatchObject({
        baseAmountMinor: 1000,
        fx: { rate: '1.2500000000', rateDate: '2026-10-01', source: 'ecb' },
      });
      expect(weekLater).toMatchObject({ baseAmountMinor: 1000, fx: { rateDate: '2026-10-01' } });
      expect(tooLate).toMatchObject({ baseAmountMinor: null, fx: null });
      expect(gbp).toMatchObject({ baseAmountMinor: null, fx: null });
    });

    it('fetches rates and backfills without bumping versions', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = addDays(today, -1);
      const [pending, early, eur] = await push(
        ann,
        { currency: 'USD', amountMinor: 2500, occurredOn: today },
        { currency: 'USD', amountMinor: 2500, occurredOn: yesterday },
        { currency: 'EUR', amountMinor: 700 },
      );
      expect(pending!.baseAmountMinor).toBeNull();
      const source = t.app.get<FxRateSource>(FX_RATE_SOURCE);
      const fetch = vi
        .spyOn(source, 'fetch')
        .mockImplementation(async (range) =>
          range === 'history'
            ? [{ date: yesterday, currency: 'USD', ratePerEur: '1.0' }]
            : [{ date: yesterday, currency: 'USD', ratePerEur: '1.0' }],
        );
      expect(await t.app.get(FxService).refresh()).toEqual({ rates: 1, filled: 2 });
      expect(fetch.mock.calls.map((call) => call[0])).toEqual(['history', 'latest']);
      const row = async (id: string) =>
        (await t.db.select().from(transactions).where(eq(transactions.id, id)))[0]!;
      expect(await row(pending!.id)).toMatchObject({
        baseAmountMinor: 2500,
        fxRateDate: yesterday,
      });

      fetch.mockClear();
      fetch.mockResolvedValue([{ date: today, currency: 'USD', ratePerEur: '1.25' }]);
      expect(await t.app.get(FxService).refresh()).toEqual({ rates: 1, filled: 1 });
      expect(fetch.mock.calls.map((call) => call[0])).toEqual(['latest']);
      const filled = await row(pending!.id);
      expect(filled).toMatchObject({
        baseAmountMinor: 2000,
        fxRate: '1.2500000000',
        fxRateDate: today,
        version: 1,
      });
      expect(filled.revision).toBeGreaterThan(eur!.revision);
      expect(await row(early!.id)).toMatchObject({ baseAmountMinor: 2500, fxRateDate: yesterday });
    });

    it('fetches the history again after a gap in stored rates', async () => {
      await t.db
        .insert(fxRates)
        .values({ date: '2020-01-02', currency: 'USD', ratePerEur: '1.1', source: 'ecb' });
      const fetch = vi
        .spyOn(t.app.get<FxRateSource>(FX_RATE_SOURCE), 'fetch')
        .mockResolvedValue([{ date: '2020-01-03', currency: 'USD', ratePerEur: '1.2' }]);
      await t.app.get(FxService).refresh();
      expect(fetch.mock.calls.map((call) => call[0])).toEqual(['history', 'latest']);
    });

    it('still stores the daily feed and backfills when the history feed fails', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [row] = await push(ann, { currency: 'USD', amountMinor: 2500, occurredOn: today });
      vi.spyOn(t.app.get<FxRateSource>(FX_RATE_SOURCE), 'fetch').mockImplementation(
        async (feed) => {
          if (feed === 'history') throw new Error('history is down');
          return [{ date: today, currency: 'USD', ratePerEur: '1.25' }];
        },
      );
      expect(await t.app.get(FxService).refresh()).toEqual({ rates: 1, filled: 1 });
      const [stored] = await t.db.select().from(transactions).where(eq(transactions.id, row!.id));
      expect(stored).toMatchObject({ baseAmountMinor: 2000, fxRateDate: today });
    });

    it('loads the full history for rows older than every stored rate, once a day', async () => {
      const today = new Date().toISOString().slice(0, 10);
      await t.db
        .insert(fxRates)
        .values({ date: today, currency: 'USD', ratePerEur: '1.25', source: 'ecb' });
      const [old] = await push(ann, {
        currency: 'USD',
        amountMinor: 1100,
        occurredOn: '2020-03-02',
      });
      const fetch = vi
        .spyOn(t.app.get<FxRateSource>(FX_RATE_SOURCE), 'fetch')
        .mockImplementation(async (feed) =>
          feed === 'full'
            ? [
                { date: '2020-03-02', currency: 'USD', ratePerEur: '1.1' },
                { date: today, currency: 'USD', ratePerEur: '9.99' },
              ]
            : [{ date: today, currency: 'USD', ratePerEur: '1.25' }],
        );
      const fx = t.app.get(FxService);
      expect(await fx.refresh()).toEqual({ rates: 3, filled: 1 });
      expect(fetch.mock.calls.map((call) => call[0])).toEqual(['latest', 'full']);
      const stored = async (id: string) =>
        (await t.db.select().from(transactions).where(eq(transactions.id, id)))[0]!;
      expect(await stored(old!.id)).toMatchObject({
        baseAmountMinor: 1000,
        fxRateDate: '2020-03-02',
        version: 1,
      });
      expect(
        (await t.db.select().from(fxRates).where(eq(fxRates.date, today)))[0]!.ratePerEur,
      ).toBe('1.2500000000');

      await push(ann, { currency: 'USD', amountMinor: 1100, occurredOn: '2019-06-03' });
      fetch.mockClear();
      await fx.refresh();
      expect(fetch.mock.calls.map((call) => call[0])).toEqual(['latest']);

      const later = Date.now() + 25 * 60 * 60_000;
      vi.spyOn(Date, 'now').mockReturnValue(later);
      fetch.mockClear();
      await fx.refresh();
      expect(fetch.mock.calls.map((call) => call[0])).toEqual(['latest', 'full']);
    });
  });
});
