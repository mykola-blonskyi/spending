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

    it('creates, edits and syncs an opening balance and date with the account (BR-40)', async () => {
      type Account = {
        id: string;
        openingBalanceMinor: number;
        openingOn: string;
        revision: number;
      };
      const plain = await json<Account>(
        await as(t, ann, '/v1/accounts', {
          method: 'POST',
          body: { workspaceId: family, name: 'Cash', kind: 'cash', currency: 'EUR' },
        }),
        201,
      );
      expect(plain).toMatchObject({
        openingBalanceMinor: 0,
        openingOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      });
      const created = await json<Account>(
        await as(t, ann, '/v1/accounts', {
          method: 'POST',
          body: {
            workspaceId: family,
            name: 'Savings',
            kind: 'savings',
            currency: 'EUR',
            openingBalanceMinor: -50000,
            openingOn: '2026-01-15',
          },
        }),
        201,
      );
      expect(created).toMatchObject({ openingBalanceMinor: -50000, openingOn: '2026-01-15' });
      const edited = await json<Account>(
        await as(t, ann, `/v1/accounts/${created.id}`, {
          method: 'PATCH',
          body: { openingBalanceMinor: 100000, openingOn: '2026-02-01' },
        }),
        200,
      );
      expect(edited).toMatchObject({ openingBalanceMinor: 100000, openingOn: '2026-02-01' });
      expect(edited.revision).toBeGreaterThan(created.revision);

      const { accounts } = await json<{ accounts: Account[] }>(
        await as(t, bob, '/v1/sync/pull?cursor=0'),
        200,
      );
      expect(accounts.find((a) => a.id === created.id)).toMatchObject({
        openingBalanceMinor: 100000,
        openingOn: '2026-02-01',
      });

      for (const body of [
        { openingBalanceMinor: 1.5 },
        { openingBalanceMinor: '100' },
        { openingBalanceMinor: 1_000_000_000_001 },
        { openingOn: '2026-02-30' },
        { openingOn: '01.02.2026' },
        { openingOn: null },
      ]) {
        const response = await as(t, ann, `/v1/accounts/${created.id}`, { method: 'PATCH', body });
        expect(response.status).toBe(400);
      }
      expect(
        (
          await as(t, ann, '/v1/accounts', {
            method: 'POST',
            body: {
              workspaceId: annPersonal,
              name: 'Bad',
              kind: 'cash',
              currency: 'EUR',
              openingBalanceMinor: 0.25,
            },
          })
        ).status,
      ).toBe(400);
    });

    it('does not write a PATCH that changes nothing', async () => {
      type Stamped = { id: string; revision: number; updatedAt: string; archivedAt: string | null };
      const patch = async (path: string, body: Record<string, unknown>) =>
        json<Stamped>(await as(t, ann, path, { method: 'PATCH', body }), 200);
      const account = await json<Stamped>(
        await as(t, ann, '/v1/accounts', {
          method: 'POST',
          body: { workspaceId: annPersonal, name: 'Visa', kind: 'card', currency: 'EUR' },
        }),
        201,
      );
      const archived = await patch(`/v1/accounts/${account.id}`, { archived: true });
      for (const body of [{ archived: true }, { name: 'Visa', kind: 'card' }, {}]) {
        expect(await patch(`/v1/accounts/${account.id}`, body)).toEqual(archived);
      }
      const renamed = await patch(`/v1/accounts/${account.id}`, { name: 'Visa', kind: 'bank' });
      expect(renamed.revision).toBeGreaterThan(archived.revision);
      expect(renamed.archivedAt).toBe(archived.archivedAt);

      const category = await json<Stamped>(
        await as(t, ann, '/v1/categories', {
          method: 'POST',
          body: {
            workspaceId: annPersonal,
            name: 'Pets',
            kind: 'expense',
            color: '#AABBCC',
            icon: 'paw',
          },
        }),
        201,
      );
      for (const body of [{ name: 'Pets', color: '#aabbcc', icon: 'paw' }, { archived: false }]) {
        expect(await patch(`/v1/categories/${category.id}`, body)).toEqual(category);
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
      const market = {
        workspaceId: family,
        name: 'Market',
        kind: 'expense',
        color: '#00ff00',
        icon: 'apple',
      };
      expect((await as(t, ann, '/v1/categories', { method: 'POST', body: market })).status).toBe(
        201,
      );
      expect((await as(t, bob, '/v1/categories', { method: 'POST', body: market })).status).toBe(
        409,
      );
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

    it('stores a default category name only once the user sets one', async () => {
      type Row = { id: string; name: string | null; systemKey: string | null };
      const { categories } = await json<{ categories: Row[] }>(
        await as(t, ann, `/v1/categories?workspaceId=${annPersonal}`),
        200,
      );
      expect(categories.filter((c) => c.systemKey !== null).map((c) => c.name)).toEqual(
        Array<null>(20).fill(null),
      );
      const groceries = categories.find((c) => c.systemKey === 'groceries')!;
      const path = `/v1/categories/${groceries.id}`;
      const renamed = await json<Row>(
        await as(t, ann, path, { method: 'PATCH', body: { name: 'Food' } }),
        200,
      );
      expect(renamed).toMatchObject({ name: 'Food', systemKey: 'groceries' });
      const reset = await json<Row>(
        await as(t, ann, path, { method: 'PATCH', body: { name: null } }),
        200,
      );
      expect(reset).toMatchObject({ name: null, systemKey: 'groceries' });
      const custom = await json<Row>(
        await as(t, ann, '/v1/categories', {
          method: 'POST',
          body: {
            workspaceId: annPersonal,
            name: 'Pets',
            kind: 'expense',
            color: '#00ff00',
            icon: 'paw-print',
          },
        }),
        201,
      );
      expect(
        (await as(t, ann, `/v1/categories/${custom.id}`, { method: 'PATCH', body: { name: null } }))
          .status,
      ).toBe(400);
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

    it('loads the full history for a row in a gap longer than the history feed', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const gapDay = addDays(today, -120);
      await t.db.insert(fxRates).values([
        { date: addDays(today, -200), currency: 'USD', ratePerEur: '1.0', source: 'ecb' },
        { date: today, currency: 'USD', ratePerEur: '1.25', source: 'ecb' },
      ]);
      const [row] = await push(ann, { currency: 'USD', amountMinor: 1100, occurredOn: gapDay });
      const source = t.app.get<FxRateSource>(FX_RATE_SOURCE);
      const fetch = vi
        .spyOn(source, 'fetch')
        .mockImplementation(async (feed) => [
          feed === 'full'
            ? { date: gapDay, currency: 'USD', ratePerEur: '1.1' }
            : { date: today, currency: 'USD', ratePerEur: '1.25' },
        ]);
      await new FxService(t.db, source).refresh();
      expect(fetch.mock.calls.map((call) => call[0])).toEqual(['latest', 'full']);
      const [stored] = await t.db.select().from(transactions).where(eq(transactions.id, row!.id));
      expect(stored).toMatchObject({ baseAmountMinor: 1000, fxRateDate: gapDay });
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
