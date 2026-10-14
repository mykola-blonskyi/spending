import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBatches, transactions } from '../src/database/schema';
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
};
type ImportResult = {
  batch: { id: string; importedCount: number; duplicateCount: number; rejectedCount: number };
  imported: { count: number; transactionIds: string[] };
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
  const remove = (s: Session, view: View) =>
    push(s, { type: 'transaction.delete', transactionId: view.id, baseVersion: view.version });
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
});
