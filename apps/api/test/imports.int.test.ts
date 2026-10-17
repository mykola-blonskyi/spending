import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categoryRules, fxRates, importBatches, transactions } from '../src/database/schema';
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

type Row = {
  line: number;
  occurredOn: string;
  amountMinor: number;
  description: string;
  currency?: string;
  externalId?: string;
  bankCategory?: string;
  mcc?: string;
};
type ImportResult = {
  batch: { id: string; importedCount: number; duplicateCount: number; rejectedCount: number };
  imported: {
    count: number;
    transactionIds: string[];
    bankCategories: Record<string, string>;
    transferSuggestions: { transactionId: string; counterpartId: string | null; reason: string }[];
  };
  duplicates: number;
  rejected: { line: number; reason: string }[];
};
type View = Record<string, unknown> & { id: string; version: number; categoryId: string | null };

describe('imports', () => {
  let provider: FakeOidc;
  let t: TestApp;
  let ann: Session;
  let bob: Session;
  let annPersonal: string;
  let account: string;

  beforeAll(async () => {
    provider = await startFakeOidc({ users: people, clients: [TEST_CLIENT] });
    t = await startTestApp({ OIDC_ISSUER: provider.issuer });
  });
  beforeEach(async () => {
    await resetData(t.db);
    [ann, bob] = await Promise.all([loginAs(t, people[0].sub), loginAs(t, people[1].sub)]);
    annPersonal = await personal(ann);
    account = await createAccount(ann, annPersonal);
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

  async function personal(s: Session): Promise<string> {
    const body = await json<{ workspaces: { id: string; kind: string }[] }>(
      await as(t, s, '/v1/workspaces'),
      200,
    );
    return body.workspaces.find((w) => w.kind === 'personal')!.id;
  }
  async function createAccount(s: Session, workspaceId: string, name = 'BBVA'): Promise<string> {
    const body = await json<{ id: string }>(
      await as(t, s, '/v1/accounts', {
        method: 'POST',
        body: { workspaceId, name, kind: 'bank', currency: 'EUR' },
      }),
      201,
    );
    return body.id;
  }

  const row = (line: number, extra: Partial<Row> = {}): Row => ({
    line,
    occurredOn: '2026-10-01',
    amountMinor: -1250,
    description: `Shop ${line}`,
    ...extra,
  });
  const post = (s: Session, rows: Row[], accountId = account) =>
    as(t, s, '/v1/imports', {
      method: 'POST',
      body: { accountId, fileName: 'statement.csv', mapping: { date: 0, amount: 2 }, rows },
    });
  const importRows = async (s: Session, rows: Row[], accountId = account) =>
    json<ImportResult>(await post(s, rows, accountId), 201);
  async function push(s: Session, mutation: Record<string, unknown>) {
    const { results } = await json<{ results: { status: string; code?: string }[] }>(
      await as(t, s, '/v1/sync/push', {
        method: 'POST',
        body: { mutations: [{ mutationId: crypto.randomUUID(), ...mutation }] },
      }),
      200,
    );
    return results[0]!;
  }
  const learn = (s: Session, items: unknown[]) =>
    as(t, s, '/v1/imports/learn', { method: 'POST', body: { items } });
  const remove = (s: Session, view: View) =>
    push(s, { type: 'transaction.delete', transactionId: view.id, baseVersion: view.version });
  const edit = (s: Session, view: View, fields: Record<string, unknown>) =>
    push(s, {
      type: 'transaction.upsert',
      baseVersion: view.version,
      transaction: {
        id: view.id,
        workspaceId: view.workspaceId,
        kind: view.kind,
        amountMinor: view.amountMinor,
        currency: view.currency,
        occurredOn: view.occurredOn,
        accountId: view.accountId,
        categoryId: view.categoryId,
        description: view.description,
        note: view.note,
        ...fields,
      },
    });
  async function categoryIds(s: Session, workspaceId: string): Promise<Map<string, string>> {
    const { categories } = await json<{
      categories: { id: string; systemKey: string | null; name: string }[];
    }>(await as(t, s, `/v1/categories?workspaceId=${workspaceId}`), 200);
    return new Map(categories.map((c) => [c.systemKey ?? c.name, c.id]));
  }
  async function history(s: Session, query = ''): Promise<View[]> {
    return (await json<{ transactions: View[] }>(await as(t, s, `/v1/transactions${query}`), 200))
      .transactions;
  }

  describe('create (BR-26)', () => {
    it('imports valid rows, rejects invalid ones with reasons, and stores the batch', async () => {
      const result = await importRows(ann, [
        row(2),
        row(3, { occurredOn: '2026-13-01' }),
        row(4, { amountMinor: 300000, description: '  Nomina  OCT ' }),
        row(5, { amountMinor: 0 }),
        row(6, { currency: 'XXQ' }),
        row(7, { description: 'x'.repeat(201) }),
        row(8, { currency: 'USD', amountMinor: -500 }),
      ]);
      expect(result.imported.count).toBe(3);
      expect(result.duplicates).toBe(0);
      expect(result.rejected).toEqual([
        { line: 3, reason: 'INVALID_DATE' },
        { line: 5, reason: 'INVALID_AMOUNT' },
        { line: 6, reason: 'INVALID_CURRENCY' },
        { line: 7, reason: 'DESCRIPTION_TOO_LONG' },
      ]);
      expect(result.batch).toMatchObject({
        accountId: account,
        fileName: 'statement.csv',
        rowCount: 7,
        importedCount: 3,
        duplicateCount: 0,
        rejectedCount: 4,
        undoneAt: null,
      });
      const [stored] = await t.db
        .select()
        .from(importBatches)
        .where(eq(importBatches.id, result.batch.id));
      expect(stored).toMatchObject({ workspaceId: annPersonal, mapping: { date: 0, amount: 2 } });
      expect(stored!.rejected).toEqual(result.rejected);

      const rows = await history(ann);
      expect(rows.map((r) => r.id).sort()).toEqual([...result.imported.transactionIds].sort());
      const byDescription = new Map(rows.map((r) => [r.description, r]));
      expect(byDescription.get('Nomina  OCT')).toMatchObject({
        kind: 'income',
        amountMinor: 300000,
        currency: 'EUR',
        baseAmountMinor: 300000,
        source: 'import',
        importBatchId: result.batch.id,
        workspaceId: annPersonal,
        accountId: account,
        reviewStatus: 'confirmed',
      });
      expect(byDescription.get('Shop 8')).toMatchObject({
        kind: 'expense',
        currency: 'USD',
        baseAmountMinor: null,
      });
    });

    it('converts a large foreign-currency batch with one rate per day (BR-14)', async () => {
      await t.db.insert(fxRates).values([
        { date: '2026-10-01', currency: 'USD', ratePerEur: '1.25', source: 'ecb' },
        { date: '2026-10-02', currency: 'USD', ratePerEur: '2', source: 'ecb' },
      ]);
      const usdAccount = await json<{ id: string }>(
        await as(t, ann, '/v1/accounts', {
          method: 'POST',
          body: { workspaceId: annPersonal, name: 'Visa', kind: 'card', currency: 'USD' },
        }),
        201,
      );
      const days = ['2026-10-01', '2026-10-02', '2026-10-03'];
      const rows = Array.from({ length: 300 }, (_, i) =>
        row(i + 2, { occurredOn: days[i % 3]!, currency: 'USD', amountMinor: -1000 }),
      );
      const result = await importRows(ann, rows, usdAccount.id);
      expect(result.imported.count).toBe(300);
      const stored = await t.db.select().from(transactions);
      const baseByDay = new Map(stored.map((r) => [r.occurredOn, r.baseAmountMinor]));
      // 10.00 USD at 1.25 and 2 USD per EUR; the 3rd takes the 2nd's rate (latest earlier day).
      expect(baseByDay.get('2026-10-01')).toBe(800);
      expect(baseByDay.get('2026-10-02')).toBe(500);
      expect(baseByDay.get('2026-10-03')).toBe(500);
    });

    it('refuses an account outside the personal workspace, archived or not visible', async () => {
      const family = await json<{ id: string }>(
        await as(t, ann, '/v1/family', { method: 'POST', body: { name: 'Home' } }),
        201,
      );
      const familyAccount = await createAccount(ann, family.id, 'Joint');
      const familyResponse = await post(ann, [row(2)], familyAccount);
      expect(familyResponse.status).toBe(422);
      expect(await errorCode(familyResponse)).toBe('INVALID_ACCOUNT');

      const bobResponse = await post(bob, [row(2)], account);
      expect(bobResponse.status).toBe(404);

      await as(t, ann, `/v1/accounts/${account}`, { method: 'PATCH', body: { archived: true } });
      const archived = await post(ann, [row(2)]);
      expect(archived.status).toBe(422);
      expect(await t.db.select().from(transactions)).toEqual([]);
      expect(await t.db.select().from(importBatches)).toEqual([]);
    });

    it('validates the envelope', async () => {
      const tooMany = await post(
        ann,
        Array.from({ length: 5001 }, (_, i) => row(i + 2)),
      );
      expect(tooMany.status).toBe(400);
      const bigMapping = await as(t, ann, '/v1/imports', {
        method: 'POST',
        body: {
          accountId: account,
          fileName: 'a.csv',
          mapping: { x: 'y'.repeat(5000) },
          rows: [row(2)],
        },
      });
      expect(bigMapping.status).toBe(400);
      expect((await post(ann, [])).status).toBe(400);
    });

    it('imports 5000 rows in one batch', async () => {
      const rows = Array.from({ length: 5000 }, (_, i) => row(i + 2, { amountMinor: -(i + 1) }));
      const result = await importRows(ann, rows);
      expect(result.imported.count).toBe(5000);
    });
  });

  describe('dedupe (BR-27)', () => {
    const statement = [
      row(2, { description: 'Mercadona' }),
      row(3, { description: 'Mercadona' }),
      row(4, { description: 'Renfe', amountMinor: -890 }),
    ];

    it('keeps identical purchases and adds nothing on re-import', async () => {
      const first = await importRows(ann, statement);
      expect(first.imported.count).toBe(3);
      const again = await importRows(ann, statement);
      expect(again).toMatchObject({ imported: { count: 0, transactionIds: [] }, duplicates: 3 });
      expect(again.batch).toMatchObject({ importedCount: 0, duplicateCount: 3, rejectedCount: 0 });
      expect(await history(ann)).toHaveLength(3);
    });

    it('adds only the new rows of an overlapping statement', async () => {
      await importRows(ann, statement);
      const overlapping = await importRows(ann, [
        row(2, { description: 'MERCADONA ' }),
        row(3, { description: 'mercadona' }),
        row(4, { description: 'Mercadona' }),
        row(5, { description: 'Renfe', amountMinor: -890 }),
        row(6, { description: 'Lidl', occurredOn: '2026-10-02' }),
      ]);
      expect(overlapping.imported.count).toBe(2);
      expect(overlapping.duplicates).toBe(3);
      expect(await history(ann)).toHaveLength(5);
    });

    it('keys rows by provider id when mapped', async () => {
      await importRows(ann, [row(2, { externalId: 'TX-1' }), row(3, { externalId: 'TX-2' })]);
      const result = await importRows(ann, [
        row(2, { externalId: 'TX-1', description: 'Renamed by the bank', amountMinor: -1 }),
        row(3, { externalId: 'TX-3' }),
        row(4, { externalId: 'TX-3' }),
      ]);
      expect(result.imported.count).toBe(1);
      expect(result.duplicates).toBe(1);
      expect(result.rejected).toEqual([{ line: 4, reason: 'DUPLICATE_IN_FILE_EXTERNAL_ID' }]);
    });

    it('scopes keys to the account', async () => {
      await importRows(ann, statement);
      const other = await createAccount(ann, annPersonal, 'Santander');
      expect((await importRows(ann, statement, other)).imported.count).toBe(3);
    });

    it('does not bring back a single deleted imported row', async () => {
      await importRows(ann, statement);
      const renfe = (await history(ann)).find((r) => r.description === 'Renfe')!;
      expect((await remove(ann, renfe)).status).toBe('applied');
      const again = await importRows(ann, statement);
      expect(again.imported.count).toBe(0);
      expect(again.duplicates).toBe(3);
      expect((await history(ann)).map((r) => r.description)).not.toContain('Renfe');
    });
  });

  describe('categorization (BR-29)', () => {
    const byDescription = async (s: Session) =>
      new Map((await history(s)).map((r) => [r.description, r]));

    it('applies built-in rules by kind and leaves unknown merchants empty', async () => {
      const ids = await categoryIds(ann, annPersonal);
      await importRows(ann, [
        row(2, { description: 'COMPRA TARJ 5489XXXX1234 MERCADONA VALENCIA' }),
        row(3, { description: 'NOMINA OCTUBRE', amountMinor: 250000 }),
        row(4, { description: 'MERCADONA', amountMinor: 500 }),
        row(5, { description: 'Ferreteria Lopez' }),
      ]);
      const rows = await byDescription(ann);
      expect(rows.get('COMPRA TARJ 5489XXXX1234 MERCADONA VALENCIA')!.categoryId).toBe(
        ids.get('groceries'),
      );
      expect(rows.get('NOMINA OCTUBRE')!.categoryId).toBe(ids.get('salary'));
      expect(rows.get('MERCADONA')!.categoryId).toBeNull();
      expect(rows.get('Ferreteria Lopez')!.categoryId).toBeNull();
    });

    it('learns from a correction through sync and uses it on the next import', async () => {
      const ids = await categoryIds(ann, annPersonal);
      await importRows(ann, [row(2, { description: 'BAR PEPE 0012 MADRID' })]);
      const imported = (await history(ann))[0]!;
      expect(imported.categoryId).toBe(ids.get('dining'));
      expect((await edit(ann, imported, { categoryId: ids.get('entertainment') })).status).toBe(
        'applied',
      );
      expect(await t.db.select().from(categoryRules)).toMatchObject([
        {
          workspaceId: annPersonal,
          merchantKey: 'bar pepe madrid',
          categoryId: ids.get('entertainment'),
        },
      ]);

      await importRows(ann, [
        row(2, { description: 'Bar Pepe 0099 Madrid', occurredOn: '2026-10-05' }),
        row(3, { description: 'Bar Manolo', occurredOn: '2026-10-05' }),
      ]);
      const rows = await byDescription(ann);
      expect(rows.get('Bar Pepe 0099 Madrid')!.categoryId).toBe(ids.get('entertainment'));
      expect(rows.get('Bar Manolo')!.categoryId).toBe(ids.get('dining'));
    });

    it('suggests from the bank category and MCC and rejects malformed hints', async () => {
      const ids = await categoryIds(ann, annPersonal);
      await importRows(ann, [
        row(2, { description: 'Kyivvodokanal', bankCategory: 'Комуналка та Інтернет' }),
        row(3, { description: 'Silpo', mcc: '5411' }),
        row(4, { description: 'Nothing', bankCategory: 'Невідома', mcc: '4829' }),
      ]);
      const rows = await byDescription(ann);
      expect(rows.get('Kyivvodokanal')!.categoryId).toBe(ids.get('utilities'));
      expect(rows.get('Silpo')!.categoryId).toBe(ids.get('groceries'));
      expect(rows.get('Nothing')!.categoryId).toBeNull();
      expect(rows.get('Silpo')).not.toHaveProperty('mcc');
      expect(await t.db.select().from(categoryRules)).toEqual([]);
      for (const bad of [{ mcc: '541' }, { mcc: 'abcd' }, { bankCategory: 'x'.repeat(101) }]) {
        expect((await post(ann, [row(2, bad)])).status).toBe(400);
      }
    });

    it('learns the bank category only while the import is open, never from history', async () => {
      const ids = await categoryIds(ann, annPersonal);
      const bankCategory = 'Комуналка та Інтернет';
      const result = await importRows(ann, [row(2, { description: 'Provider One', bankCategory })]);
      const id = result.imported.transactionIds[0]!;
      expect(result.imported.bankCategories).toEqual({ [id]: bankCategory });
      const imported = (await history(ann))[0]!;
      expect(imported.categoryId).toBe(ids.get('utilities'));
      expect((await edit(ann, imported, { categoryId: ids.get('housing') })).status).toBe(
        'applied',
      );
      const keys = async () =>
        (await t.db.select().from(categoryRules)).map((r) => r.merchantKey).sort();
      expect(await keys()).toEqual(['provider one']);

      const item = { transactionId: id, categoryId: ids.get('housing'), bankCategory };
      expect((await learn(ann, [item])).status).toBe(204);
      expect(await keys()).toEqual(['bank:комуналка та інтернет', 'provider one']);
      await importRows(ann, [
        row(2, { description: 'Other Provider', bankCategory, occurredOn: '2026-10-05' }),
      ]);
      expect((await byDescription(ann)).get('Other Provider')!.categoryId).toBe(ids.get('housing'));
    });

    it('learns from the import screen only for own imported rows and matching categories', async () => {
      const ids = await categoryIds(ann, annPersonal);
      const { imported } = await importRows(ann, [row(2, { bankCategory: 'Кафе' })]);
      const transactionId = imported.transactionIds[0]!;
      const item = { transactionId, categoryId: ids.get('dining'), bankCategory: 'Кафе' };
      expect((await learn(ann, [{ ...item, bankCategory: 'x'.repeat(101) }])).status).toBe(400);
      expect((await learn(ann, [{ ...item, categoryId: ids.get('salary') }])).status).toBe(422);
      expect((await learn(bob, [item])).status).toBe(404);
      expect(await t.db.select().from(categoryRules)).toEqual([]);
    });

    it('does not learn from manual rows or unchanged categories', async () => {
      const ids = await categoryIds(ann, annPersonal);
      await importRows(ann, [row(2, { description: 'Mercadona' })]);
      const imported = (await history(ann))[0]!;
      expect((await edit(ann, imported, { note: 'weekly shop' })).status).toBe('applied');
      const manual = {
        id: crypto.randomUUID(),
        workspaceId: annPersonal,
        kind: 'expense',
        amountMinor: 100,
        currency: 'EUR',
        occurredOn: '2026-10-01',
        accountId: null,
        categoryId: null,
        description: 'Lidl',
        note: '',
      };
      await push(ann, { type: 'transaction.upsert', baseVersion: null, transaction: manual });
      await push(ann, {
        type: 'transaction.upsert',
        baseVersion: 1,
        transaction: { ...manual, categoryId: ids.get('shopping') },
      });
      expect(await t.db.select().from(categoryRules)).toEqual([]);
    });

    it('ignores a learned rule whose category was archived', async () => {
      const ids = await categoryIds(ann, annPersonal);
      await importRows(ann, [row(2, { description: 'Mercadona' })]);
      await edit(ann, (await history(ann))[0]!, { categoryId: ids.get('shopping') });
      await as(t, ann, `/v1/categories/${ids.get('shopping')}`, {
        method: 'PATCH',
        body: { archived: true },
      });
      await importRows(ann, [row(2, { description: 'Mercadona', occurredOn: '2026-10-09' })]);
      const fresh = (await history(ann)).find((r) => r.occurredOn === '2026-10-09')!;
      expect(fresh.categoryId).toBe(ids.get('groceries'));
    });
  });

  describe('transfer suggestions (BR-38)', () => {
    it('suggests the other side and transfer phrases in the response and stores nothing', async () => {
      const savings = await createAccount(ann, annPersonal, 'Savings');
      const other = {
        id: crypto.randomUUID(),
        workspaceId: annPersonal,
        kind: 'income',
        amountMinor: 50000,
        currency: 'EUR',
        occurredOn: '2026-10-02',
        accountId: savings,
        categoryId: null,
        description: 'From BBVA',
        note: '',
      };
      await push(ann, { type: 'transaction.upsert', baseVersion: null, transaction: other });
      const statement = [
        row(2, { amountMinor: -50000, description: 'To savings' }),
        row(3, { amountMinor: -2000, description: 'TRASPASO A CUENTA' }),
        row(4),
      ];
      const { imported } = await importRows(ann, statement);
      const [toSavings, traspaso] = imported.transactionIds;
      expect(imported.transferSuggestions).toEqual([
        { transactionId: toSavings, counterpartId: other.id, reason: 'counterpart' },
        { transactionId: traspaso, counterpartId: null, reason: 'keyword' },
      ]);
      const stored = await t.db
        .select({ transferId: transactions.transferId, outside: transactions.transferOutside })
        .from(transactions);
      expect(stored).toHaveLength(4);
      expect(stored.every((r) => r.transferId === null && !r.outside)).toBe(true);

      const again = await importRows(ann, statement);
      expect(again.imported.transferSuggestions).toEqual([]);
    });
  });

  describe('history and undo (BR-30)', () => {
    type Undo = { batch: { id: string; undoneAt: string | null }; deleted: number; kept: number };
    const undo = (s: Session, id: string) => as(t, s, `/v1/imports/${id}/undo`, { method: 'POST' });
    const statement = [row(2), row(3), row(4)];

    it("lists only the actor's batches, newest first", async () => {
      const first = await importRows(ann, [row(2)]);
      const second = await importRows(ann, [row(2), row(3)]);
      await importRows(bob, [row(2)], await createAccount(bob, await personal(bob)));
      const { batches } = await json<{ batches: { id: string; importedCount: number }[] }>(
        await as(t, ann, '/v1/imports'),
        200,
      );
      expect(batches.map((b) => [b.id, b.importedCount])).toEqual([
        [second.batch.id, 1],
        [first.batch.id, 1],
      ]);
    });

    it('deletes unedited rows, keeps edited ones, repeats idempotently and allows re-import', async () => {
      const { batch } = await importRows(ann, statement);
      const [edited, deletedBefore] = await history(ann);
      expect((await edit(ann, edited!, { note: 'checked' })).status).toBe('applied');
      expect((await remove(ann, deletedBefore!)).status).toBe('applied');

      const first = await json<Undo>(await undo(ann, batch.id), 200);
      expect(first).toMatchObject({ deleted: 1, kept: 1 });
      expect(first.batch.undoneAt).not.toBeNull();
      expect((await history(ann)).map((r) => r.id)).toEqual([edited!.id]);
      expect(await json<Undo>(await undo(ann, batch.id), 200)).toEqual(first);

      const again = await importRows(ann, statement);
      expect(again.imported.count).toBe(1);
      expect(again.duplicates).toBe(2);
      expect(await history(ann)).toHaveLength(2);
    });

    it("refuses another user's batch", async () => {
      const { batch } = await importRows(ann, statement);
      expect((await undo(bob, batch.id)).status).toBe(404);
      expect(await history(ann)).toHaveLength(3);
    });
  });

  describe('family review queue (BR-28)', () => {
    type Review = { items: { transaction: View; familyCategoryId: string | null }[] };
    let family: string;

    beforeEach(async () => {
      family = (
        await json<{ id: string }>(
          await as(t, ann, '/v1/family', { method: 'POST', body: { name: 'Home' } }),
          201,
        )
      ).id;
      const { url } = await json<{ url: string }>(
        await as(t, ann, '/v1/family/invitations', { method: 'POST', body: {} }),
        201,
      );
      await as(t, bob, `/v1/invitations/${url.split('/invite/')[1]}/accept`, { method: 'POST' });
    });

    const confirm = (s: Session, items: unknown[]) =>
      as(t, s, '/v1/imports/review/confirm', { method: 'POST', body: { items } });
    const pulled = async (s: Session) =>
      (await json<{ transactions: { id: string }[] }>(await as(t, s, '/v1/sync/pull'), 200))
        .transactions;

    it('holds imported rows for review, invisible to everyone else', async () => {
      const personalIds = await categoryIds(ann, annPersonal);
      const familyIds = await categoryIds(ann, family);
      const { imported } = await importRows(ann, [row(2, { description: 'MERCADONA' }), row(3)]);
      expect(await history(ann)).toEqual([]);
      expect(await history(ann, '?reviewStatus=pending_review')).toHaveLength(2);
      expect(await history(bob)).toEqual([]);
      const bobPull = (await pulled(bob)).map((r) => r.id);
      expect(bobPull.filter((id) => imported.transactionIds.includes(id))).toEqual([]);

      const review = await json<Review>(await as(t, ann, '/v1/imports/review'), 200);
      const mercadona = review.items.find((i) => i.transaction.description === 'MERCADONA')!;
      expect(mercadona.transaction).toMatchObject({
        reviewStatus: 'pending_review',
        categoryId: personalIds.get('groceries'),
      });
      expect(mercadona.familyCategoryId).toBe(familyIds.get('groceries'));
      expect((await json<Review>(await as(t, bob, '/v1/imports/review'), 200)).items).toEqual([]);
    });

    it('suggests no transfers while the rows wait for review (BR-38)', async () => {
      const { imported } = await importRows(ann, [row(2, { description: 'TRASPASO A CUENTA' })]);
      expect(imported.transferSuggestions).toEqual([]);
    });

    it('confirms rows as family or personal and learns the categories', async () => {
      const personalIds = await categoryIds(ann, annPersonal);
      const familyIds = await categoryIds(ann, family);
      const { imported } = await importRows(ann, [
        row(2, { description: 'MERCADONA' }),
        row(3, { description: 'Bar Pepe' }),
      ]);
      const [shared, mine] = imported.transactionIds;
      const { transactions: confirmed } = await json<{ transactions: View[] }>(
        await confirm(ann, [
          { transactionId: shared, scope: 'family', categoryId: familyIds.get('groceries') },
          { transactionId: mine, scope: 'personal', categoryId: personalIds.get('entertainment') },
        ]),
        200,
      );
      expect(confirmed).toMatchObject([
        { id: shared, workspaceId: family, reviewStatus: 'confirmed', accountId: account },
        { id: mine, workspaceId: annPersonal, categoryId: personalIds.get('entertainment') },
      ]);
      const bobSees = await history(bob);
      expect(bobSees.map((r) => r.id)).toEqual([shared]);
      expect(bobSees[0]).toMatchObject({ accountId: null, categoryId: familyIds.get('groceries') });
      expect((await pulled(bob)).map((r) => r.id)).toContain(shared);
      expect((await history(ann)).map((r) => r.id).sort()).toEqual([shared, mine].sort());

      const rules = await t.db.select().from(categoryRules);
      expect(rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ workspaceId: family, merchantKey: 'mercadona' }),
          expect.objectContaining({
            workspaceId: annPersonal,
            merchantKey: 'bar pepe',
            categoryId: personalIds.get('entertainment'),
          }),
        ]),
      );
      expect(
        (await confirm(ann, [{ transactionId: mine, scope: 'personal', categoryId: null }])).status,
      ).toBe(404);
    });

    it('learns the bank category when a review is confirmed', async () => {
      const ids = await categoryIds(ann, annPersonal);
      const { imported } = await importRows(ann, [
        row(2, { description: 'Zerno', bankCategory: 'Кафе' }),
      ]);
      await confirm(ann, [
        {
          transactionId: imported.transactionIds[0]!,
          scope: 'personal',
          categoryId: ids.get('entertainment'),
          bankCategory: 'Кафе',
        },
      ]);
      expect((await t.db.select().from(categoryRules)).map((r) => r.merchantKey)).toContain(
        'bank:кафе',
      );
    });

    it('learns the last category chosen for a merchant confirmed twice at once', async () => {
      const ids = await categoryIds(ann, annPersonal);
      const { imported } = await importRows(ann, [
        row(2, { description: 'MERCADONA' }),
        row(3, { description: 'Mercadona' }),
      ]);
      const [first, second] = imported.transactionIds;
      expect(
        (
          await confirm(ann, [
            { transactionId: first, scope: 'personal', categoryId: ids.get('groceries') },
            { transactionId: second, scope: 'personal', categoryId: ids.get('shopping') },
          ])
        ).status,
      ).toBe(200);
      expect(await t.db.select().from(categoryRules)).toEqual([
        expect.objectContaining({ merchantKey: 'mercadona', categoryId: ids.get('shopping') }),
      ]);
    });

    it('rejects foreign rows, foreign or mismatched categories, all or nothing', async () => {
      const personalIds = await categoryIds(ann, annPersonal);
      const bobIds = await categoryIds(bob, await personal(bob));
      const { imported } = await importRows(ann, [row(2), row(3)]);
      const [a, b] = imported.transactionIds;
      const item = (
        transactionId: string,
        scope: string,
        categoryId: string | null | undefined,
      ) => ({
        transactionId,
        scope,
        categoryId,
      });

      expect((await confirm(bob, [item(a!, 'family', null)])).status).toBe(404);
      for (const bad of [
        item(a!, 'personal', bobIds.get('groceries')),
        item(a!, 'family', personalIds.get('groceries')),
        item(a!, 'personal', personalIds.get('salary')),
      ]) {
        const response = await confirm(ann, [item(b!, 'personal', null), bad]);
        expect(response.status).toBe(422);
        expect(await errorCode(response)).toBe('INVALID_CATEGORY');
      }
      expect(
        (await confirm(ann, [item(a!, 'family', null), item(a!, 'personal', null)])).status,
      ).toBe(400);
      expect(await history(ann, '?reviewStatus=pending_review')).toHaveLength(2);
    });

    it('keeps a suggested category archived since, but refuses picking an archived one (BR-4)', async () => {
      const ids = await categoryIds(ann, annPersonal);
      const { imported } = await importRows(ann, [
        row(2, { description: 'MERCADONA' }),
        row(3, { description: 'Bar Pepe' }),
      ]);
      const [suggested, other] = imported.transactionIds;
      await as(t, ann, `/v1/categories/${ids.get('groceries')}`, {
        method: 'PATCH',
        body: { archived: true },
      });
      const picked = await confirm(ann, [
        { transactionId: other, scope: 'personal', categoryId: ids.get('groceries') },
      ]);
      expect(picked.status).toBe(422);
      expect(await errorCode(picked)).toBe('INVALID_CATEGORY');
      expect(
        (
          await confirm(ann, [
            { transactionId: suggested, scope: 'personal', categoryId: ids.get('groceries') },
          ])
        ).status,
      ).toBe(200);
    });

    it('lets a pending row of a former member be confirmed as personal only', async () => {
      const { imported } = await importRows(
        bob,
        [row(2)],
        await createAccount(bob, await personal(bob)),
      );
      expect((await as(t, bob, '/v1/family/leave', { method: 'POST' })).status).toBeLessThan(300);
      const [id] = imported.transactionIds;
      expect(
        (await confirm(bob, [{ transactionId: id, scope: 'family', categoryId: null }])).status,
      ).toBe(404);
      expect(
        (await confirm(bob, [{ transactionId: id, scope: 'personal', categoryId: null }])).status,
      ).toBe(200);
    });
  });
});
