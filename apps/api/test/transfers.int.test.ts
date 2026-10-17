import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { transactions } from '../src/database/schema';
import { type FakeOidc, startFakeOidc } from './fake-oidc/server';
import {
  as,
  categoriesOf,
  createFamily,
  loginAs,
  type PushedRow,
  pushNew,
  resetData,
  type Session,
  startTestApp,
  TEST_CLIENT,
  type TestApp,
  workspacesOf,
} from './harness';

const person = (name: string) => ({ sub: `sub-${name}`, email: `${name}@example.test`, name });
const people = [person('Ann'), person('Bob')] as const;

type Result = { status: string; code?: string; conflictId?: string; transaction: PushedRow };
type Totals = { incomeMinor: number; expenseMinor: number; balanceMinor: number };
type Summary = {
  totals: Totals;
  byCategory: { categoryId: string | null; amountMinor: number }[];
  series: { bucket: string; incomeMinor: number; expenseMinor: number }[];
  previous: { totals: Totals; byCategory: { categoryId: string | null }[] };
};

describe('transfers (BR-37)', () => {
  let provider: FakeOidc;
  let t: TestApp;
  let ann: Session;
  let bob: Session;
  let personal: string;
  let family: string;
  let groceries: string;
  let salary: string;
  let card: string;
  let savings: string;

  beforeAll(async () => {
    provider = await startFakeOidc({ users: people, clients: [TEST_CLIENT] });
    t = await startTestApp({ OIDC_ISSUER: provider.issuer });
  });
  beforeEach(async () => {
    await resetData(t.db);
    [ann, bob] = await Promise.all([loginAs(t, people[0].sub), loginAs(t, people[1].sub)]);
    family = await createFamily(t, ann, bob);
    personal = (await workspacesOf(t, ann)).personal;
    const categories = await categoriesOf(t, ann, personal);
    groceries = categories.groceries!;
    salary = categories.salary!;
    const account = async (name: string) => {
      const response = await as(t, ann, '/v1/accounts', {
        method: 'POST',
        body: { workspaceId: personal, name, kind: 'card', currency: 'EUR' },
      });
      return ((await response.json()) as { id: string }).id;
    };
    card = await account('Card');
    savings = await account('Savings');
  });
  afterAll(async () => {
    await t.app.close();
    await provider.close();
  });

  const push = async (s: Session, rows: { row: PushedRow; patch: Record<string, unknown> }[]) => {
    const mutations = rows.map(({ row, patch }) => ({
      mutationId: crypto.randomUUID(),
      type: 'transaction.upsert',
      baseVersion: row.version,
      transaction: {
        id: row.id,
        workspaceId: row.workspaceId,
        kind: row.kind,
        amountMinor: row.amountMinor,
        currency: row.currency,
        occurredOn: row.occurredOn,
        accountId: row.accountId,
        categoryId: row.categoryId,
        description: row.description,
        note: row.note,
        transferId: row.transferId,
        transferOutside: row.transferOutside,
        ...patch,
      },
    }));
    const response = await as(t, s, '/v1/sync/push', { method: 'POST', body: { mutations } });
    expect(response.status, await response.clone().text()).toBe(200);
    return ((await response.json()) as { results: Result[] }).results;
  };
  const link = (rows: PushedRow[], transferId = crypto.randomUUID()) =>
    push(
      ann,
      rows.map((row) => ({ row, patch: { transferId, categoryId: null } })),
    );
  const summary = async (query = '') => {
    const response = await as(
      t,
      ann,
      `/v1/analytics/summary?from=2026-10-01&to=2026-10-31&compare=previous${query}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as Summary;
  };

  /** A move of 300 € from the card to savings, one salary and one grocery purchase. */
  const seed = () =>
    pushNew(t, ann, [
      { workspaceId: personal, accountId: card, kind: 'expense', amountMinor: 30_000 },
      { workspaceId: personal, accountId: savings, kind: 'income', amountMinor: 30_000 },
      {
        workspaceId: personal,
        accountId: card,
        kind: 'income',
        amountMinor: 200_000,
        categoryId: salary,
      },
      {
        workspaceId: personal,
        accountId: card,
        kind: 'expense',
        amountMinor: 5_000,
        categoryId: groceries,
      },
      // Last month, for the comparison: a one-sided move to an account outside the app.
      { workspaceId: personal, accountId: card, amountMinor: 70_000, occurredOn: '2026-09-15' },
    ]);

  it('links two entries, makes them neither income nor spending, and unlinks them', async () => {
    const [out, into, , , september] = await seed();
    const before = await summary();
    expect(before.totals).toEqual({
      incomeMinor: 230_000,
      expenseMinor: 35_000,
      balanceMinor: 195_000,
    });

    const transferId = crypto.randomUUID();
    const linked = await link([out!, into!], transferId);
    expect(linked.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(linked.map((r) => r.transaction)).toMatchObject([
      { transferId, transferOutside: false, categoryId: null, version: 2 },
      { transferId, transferOutside: false, categoryId: null, version: 2 },
    ]);
    const outside = await push(ann, [
      { row: september!, patch: { transferId: crypto.randomUUID(), transferOutside: true } },
    ]);
    expect(outside[0]).toMatchObject({ status: 'applied', transaction: { transferOutside: true } });

    const after = await summary();
    expect(after.totals).toEqual({
      incomeMinor: 200_000,
      expenseMinor: 5_000,
      balanceMinor: 195_000,
    });
    expect(after.byCategory.map((c) => c.categoryId).sort()).toEqual([groceries, salary].sort());
    expect(after.series.find((b) => b.bucket === '2026-10-01')).toMatchObject({
      incomeMinor: 200_000,
      expenseMinor: 5_000,
    });
    expect(after.previous.totals).toEqual({ incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 });
    expect(after.previous.byCategory).toEqual([]);

    // Balances: each account still holds its side of the move.
    const accountRows = async (accountId: string) =>
      (
        (await (await as(t, ann, `/v1/transactions?accountId=${accountId}`)).json()) as {
          transactions: { kind: string; amountMinor: number }[];
        }
      ).transactions.reduce((sum, r) => sum + (r.kind === 'income' ? 1 : -1) * r.amountMinor, 0);
    expect(await accountRows(savings)).toBe(30_000);
    expect(await accountRows(card)).toBe(200_000 - 5_000 - 30_000 - 70_000);

    const unlinked = await push(
      ann,
      linked.map((r) => ({ row: r.transaction, patch: { transferId: null } })),
    );
    expect(unlinked.map((r) => r.transaction)).toMatchObject([
      { transferId: null, transferOutside: false, categoryId: null, version: 3 },
      { transferId: null, transferOutside: false, categoryId: null, version: 3 },
    ]);
    expect((await summary()).totals).toEqual({
      incomeMinor: 230_000,
      expenseMinor: 35_000,
      balanceMinor: 195_000,
    });
  });

  it('keeps transfers out of budgets', async () => {
    const [out, into] = await seed();
    const put = await as(t, ann, '/v1/budgets', {
      method: 'PUT',
      body: { workspaceId: personal, categoryId: groceries, amountMinor: 100_000 },
    });
    expect(put.status).toBe(200);
    const spent = async () =>
      (
        (await (await as(t, ann, '/v1/budgets?month=2026-10')).json()) as {
          budgets: { spentMinor: number }[];
        }
      ).budgets[0]!.spentMinor;
    const [grocerySide] = await push(ann, [{ row: out!, patch: { categoryId: groceries } }]);
    expect(await spent()).toBe(35_000);
    await link([grocerySide!.transaction, into!]);
    expect(await spent()).toBe(5_000);
  });

  it('refuses a category, a third side, the same kind and another space', async () => {
    const [out, into, wage, food] = await seed();
    const [familyRow] = await pushNew(t, ann, [{ workspaceId: family, kind: 'income' }]);
    const transferId = crypto.randomUUID();
    await link([out!, into!], transferId);
    const codes = async (row: PushedRow, patch: Record<string, unknown>) =>
      (await push(ann, [{ row, patch: { transferId, ...patch } }]))[0]!.code;

    expect(await codes(food!, {})).toBe('INVALID_TRANSFER');
    expect(await codes(familyRow!, {})).toBe('INVALID_TRANSFER');
    expect(await codes(wage!, { transferId: crypto.randomUUID() })).toBe('INVALID_TRANSFER');
    const [lone] = await pushNew(t, ann, [{ workspaceId: personal, kind: 'expense' }]);
    const other = crypto.randomUUID();
    await push(ann, [{ row: lone!, patch: { transferId: other } }]);
    const [sameKind] = await pushNew(t, ann, [{ workspaceId: personal, kind: 'expense' }]);
    expect(await codes(sameKind!, { transferId: other })).toBe('INVALID_TRANSFER');
    const [crossSpace] = await pushNew(t, ann, [{ workspaceId: family, kind: 'income' }]);
    expect(await codes(crossSpace!, { transferId: other })).toBe('INVALID_TRANSFER');
  });

  it('refuses a third side, the same kind and another space in the database too', async () => {
    const [out, into, , food] = await seed();
    const [familyRow] = await pushNew(t, ann, [{ workspaceId: family, kind: 'income' }]);
    const transferId = crypto.randomUUID();
    await link([out!, into!], transferId);
    const mark = (id: string, patch: { transferId: string; transferOutside?: boolean }) =>
      t.db
        .update(transactions)
        .set({ categoryId: null, ...patch })
        .where(eq(transactions.id, id));

    await expect(mark(food!.id, { transferId })).rejects.toThrow();
    await expect(mark(out!.id, { transferId, transferOutside: true })).rejects.toThrow();
    const other = crypto.randomUUID();
    await mark(food!.id, { transferId: other });
    await expect(mark(familyRow!.id, { transferId: other })).rejects.toThrow();
    await expect(mark(out!.id, { transferId: other })).rejects.toThrow();
  });

  it('keeps the mark when a client older than transfers edits a side', async () => {
    const [out, into] = await seed();
    const [linked] = await link([out!, into!]);
    const [edited] = await push(ann, [
      {
        row: linked!.transaction,
        patch: { transferId: undefined, transferOutside: undefined, note: 'old tab' },
      },
    ]);
    expect(edited!.transaction).toMatchObject({
      note: 'old tab',
      transferId: linked!.transaction.transferId,
    });
  });

  it('turns a stale mark into an ordinary conflict', async () => {
    const [out, into] = await seed();
    await push(ann, [{ row: out!, patch: { amountMinor: 31_000 } }]);
    const results = await link([out!, into!]);
    expect(results.map((r) => r.status)).toEqual(['conflict', 'applied']);
    const conflicts = (
      (await (await as(t, ann, '/v1/sync/conflicts')).json()) as {
        conflicts: { transactionId: string; local: { transferId: string | null } }[];
      }
    ).conflicts;
    expect(conflicts).toMatchObject([
      { transactionId: out!.id, local: { transferId: expect.any(String) } },
    ]);
  });

  const sideOf = async (id: string) =>
    (
      await t.db
        .select({
          transferId: transactions.transferId,
          outside: transactions.transferOutside,
          version: transactions.version,
          deletedAt: transactions.deletedAt,
        })
        .from(transactions)
        .where(eq(transactions.id, id))
    )[0]!;
  const removeSides = async (rows: PushedRow[]) => {
    const mutations = rows.map((row) => ({
      mutationId: crypto.randomUUID(),
      type: 'transaction.delete',
      transactionId: row.id,
      baseVersion: row.version,
    }));
    const response = await as(t, ann, '/v1/sync/push', { method: 'POST', body: { mutations } });
    expect(response.status, await response.clone().text()).toBe(200);
    return ((await response.json()) as { results: Result[] }).results.map((r) => r.status);
  };

  it('leaves the other side one-sided when one side is deleted alone', async () => {
    const [out, into, wage, food] = await seed();
    const transferId = crypto.randomUUID();
    const [linkedOut, linkedInto] = await link([out!, into!], transferId);
    expect(await removeSides([linkedOut!.transaction])).toEqual(['applied']);
    expect(await sideOf(into!.id)).toEqual({
      transferId,
      outside: true,
      version: linkedInto!.transaction.version + 1,
      deletedAt: null,
    });

    const both = await link([wage!, food!]);
    expect(await removeSides(both.map((r) => r.transaction))).toEqual(['applied', 'applied']);
  });

  it('leaves no orphan when a dropped mark is resolved with the server version', async () => {
    const [out, into] = await seed();
    await push(ann, [{ row: out!, patch: { amountMinor: 31_000 } }]);
    const transferId = crypto.randomUUID();
    const [conflict, applied] = await link([out!, into!], transferId);
    expect([conflict!.status, applied!.status]).toEqual(['conflict', 'applied']);
    const resolved = await as(t, ann, `/v1/sync/conflicts/${conflict!.conflictId}/resolve`, {
      method: 'POST',
      body: { resolution: 'server' },
    });
    expect(resolved.status, await resolved.clone().text()).toBe(200);
    expect(await sideOf(into!.id)).toMatchObject({
      transferId,
      outside: true,
      version: applied!.transaction.version + 1,
    });
  });

  it('marks transfers in the JSON export (BR-31)', async () => {
    const [out, into, , , september] = await seed();
    const transferId = crypto.randomUUID();
    await link([out!, into!], transferId);
    const outsideId = crypto.randomUUID();
    await push(ann, [{ row: september!, patch: { transferId: outsideId, transferOutside: true } }]);
    const response = await as(t, ann, '/v1/me/export');
    expect(response.status).toBe(200);
    const { transactions: rows } = (await response.json()) as {
      transactions: { id: string; transferId: string | null; transferOutside: boolean }[];
    };
    const marks = new Map(rows.map((r) => [r.id, [r.transferId, r.transferOutside]]));
    expect(marks.get(out!.id)).toEqual([transferId, false]);
    expect(marks.get(into!.id)).toEqual([transferId, false]);
    expect(marks.get(september!.id)).toEqual([outsideId, true]);
    expect([...marks.values()].filter(([id]) => id === null)).toHaveLength(2);
  });

  it('keeps the other side as a one-sided transfer when its import is undone', async () => {
    const imported = await as(t, ann, '/v1/imports', {
      method: 'POST',
      body: {
        accountId: card,
        fileName: 'statement.csv',
        mapping: { date: 0, amount: 2 },
        rows: [
          { line: 2, occurredOn: '2026-10-01', amountMinor: -30_000, description: 'To savings' },
        ],
      },
    });
    expect(imported.status, await imported.clone().text()).toBe(201);
    const { batch } = (await imported.json()) as { batch: { id: string } };
    const transferId = crypto.randomUUID();
    // Linked at import, as suggestions will do (#110): still version 1, so undo deletes it.
    await t.db.transaction(async (tx) => {
      await tx.execute(sql`alter table transactions disable trigger transactions_version`);
      await tx
        .update(transactions)
        .set({ transferId, categoryId: null })
        .where(eq(transactions.importBatchId, batch.id));
      await tx.execute(sql`set constraints transactions_transfer_shape immediate`);
      await tx.execute(sql`alter table transactions enable trigger transactions_version`);
    });
    const [manual] = await pushNew(t, ann, [
      { workspaceId: personal, accountId: savings, kind: 'income', amountMinor: 30_000 },
    ]);
    const [linked] = await push(ann, [{ row: manual!, patch: { transferId } }]);
    expect(linked).toMatchObject({ status: 'applied', transaction: { version: 2 } });

    const undone = await as(t, ann, `/v1/imports/${batch.id}/undo`, { method: 'POST' });
    expect(await undone.json()).toMatchObject({ deleted: 1, kept: 0 });
    const sides = await t.db
      .select({
        id: transactions.id,
        deletedAt: transactions.deletedAt,
        transferId: transactions.transferId,
        outside: transactions.transferOutside,
        version: transactions.version,
      })
      .from(transactions)
      .where(eq(transactions.transferId, transferId));
    expect(sides.find((side) => side.id === manual!.id)).toEqual({
      id: manual!.id,
      deletedAt: null,
      transferId,
      outside: true,
      version: 3,
    });
    expect(sides.find((side) => side.id !== manual!.id)?.deletedAt).not.toBeNull();
  });

  it('splits a family transfer whose sides land in two spaces when the family is deleted', async () => {
    const [annSide] = await pushNew(t, ann, [{ workspaceId: family, kind: 'expense' }]);
    const [bobSide] = await pushNew(t, bob, [{ workspaceId: family, kind: 'income' }]);
    const transferId = crypto.randomUUID();
    await link([annSide!], transferId);
    await push(bob, [{ row: bobSide!, patch: { transferId } }]);
    const deleted = await as(t, ann, '/v1/family', {
      method: 'DELETE',
      body: { confirmName: 'Home' },
    });
    expect(deleted.status, await deleted.clone().text()).toBe(204);
    const sides = await t.db
      .select({ transferId: transactions.transferId, outside: transactions.transferOutside })
      .from(transactions)
      .where(eq(transactions.amountMinor, 1000));
    expect(sides).toHaveLength(2);
    expect(sides.every((side) => side.outside && side.transferId !== transferId)).toBe(true);
    expect(sides[0]!.transferId).not.toBe(sides[1]!.transferId);
  });

  it('leaves a half-linked transfer outside the deleted family untouched', async () => {
    const bobPersonal = (await workspacesOf(t, bob)).personal;
    const [annSide] = await pushNew(t, ann, [
      { workspaceId: personal, kind: 'expense', amountMinor: 2000 },
    ]);
    const [bobSide] = await pushNew(t, bob, [
      { workspaceId: bobPersonal, kind: 'income', amountMinor: 2000 },
    ]);
    const transferId = crypto.randomUUID();
    await t.db
      .update(transactions)
      .set({ transferId, deletedAt: sql`now()` })
      .where(eq(transactions.id, bobSide!.id));
    await t.db.update(transactions).set({ transferId }).where(eq(transactions.id, annSide!.id));
    const before = await t.db
      .select()
      .from(transactions)
      .where(eq(transactions.transferId, transferId));
    const deleted = await as(t, ann, '/v1/family', {
      method: 'DELETE',
      body: { confirmName: 'Home' },
    });
    expect(deleted.status, await deleted.clone().text()).toBe(204);
    const after = await t.db
      .select()
      .from(transactions)
      .where(eq(transactions.transferId, transferId));
    expect(after).toEqual(before);
  });

  it('keeps a family side one-sided when its partner had no author left', async () => {
    const [annSide] = await pushNew(t, ann, [{ workspaceId: family, kind: 'expense' }]);
    const [bobSide] = await pushNew(t, bob, [{ workspaceId: family, kind: 'income' }]);
    const transferId = crypto.randomUUID();
    await link([annSide!], transferId);
    await push(bob, [{ row: bobSide!, patch: { transferId } }]);
    await t.db
      .update(transactions)
      .set({ createdBy: null })
      .where(eq(transactions.id, bobSide!.id));
    const deleted = await as(t, ann, '/v1/family', {
      method: 'DELETE',
      body: { confirmName: 'Home' },
    });
    expect(deleted.status, await deleted.clone().text()).toBe(204);
    const sides = await t.db
      .select({ transferId: transactions.transferId, outside: transactions.transferOutside })
      .from(transactions)
      .where(eq(transactions.amountMinor, 1000));
    expect(sides).toHaveLength(1);
    expect(sides[0]!.outside).toBe(true);
    expect(sides[0]!.transferId).not.toBe(transferId);
  });
});
