import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  accounts,
  syncConflicts,
  syncMutations,
  syncTombstones,
  transactions,
  users,
} from '../src/database/schema';
import { SyncService } from '../src/sync/sync.service';
import { testDatabaseUrl } from './env';
import { type FakeOidc, startFakeOidc } from './fake-oidc/server';
import {
  as,
  loginAs,
  resetData,
  SESSION_COOKIE,
  type Session,
  startTestApp,
  TEST_APP_ORIGIN,
  TEST_CLIENT,
  type TestApp,
} from './harness';

const person = (name: string) => ({ sub: `sub-${name}`, email: `${name}@example.test`, name });
const people = [person('Ann'), person('Bob'), person('Cat')] as const;

type Row = Record<string, unknown> & { id: string; version: number; revision: number };
type Result = {
  mutationId: string;
  status: 'applied' | 'conflict' | 'rejected';
  transaction?: Row;
  conflictId?: string;
  code?: string;
};
type Pull = {
  epoch: string;
  workspaces: { id: string; kind: string }[];
  accounts: { id: string; workspaceId: string }[];
  categories: { id: string; workspaceId: string }[];
  transactions: Row[];
  conflicts: { id: string; transactionId: string; local: unknown; server: Row }[];
  cursor: number;
  hasMore: boolean;
};

describe('sync', () => {
  let provider: FakeOidc;
  let t: TestApp;
  let ann: Session;
  let bob: Session;
  let cat: Session;
  let annPersonal: string;
  let bobPersonal: string;
  let family: string;

  beforeAll(async () => {
    provider = await startFakeOidc({ users: people, clients: [TEST_CLIENT] });
    t = await startTestApp({ OIDC_ISSUER: provider.issuer });
  });
  beforeEach(async () => {
    await resetData(t.db);
    [ann, bob, cat] = await Promise.all([
      loginAs(t, people[0].sub),
      loginAs(t, people[1].sub),
      loginAs(t, people[2].sub),
    ]);
    const created = await (
      await as(t, ann, '/v1/family', { method: 'POST', body: { name: 'Home' } })
    ).json();
    family = (created as { id: string }).id;
    const invite = (await (
      await as(t, ann, '/v1/family/invitations', { method: 'POST', body: {} })
    ).json()) as { url: string };
    const token = invite.url.split('/invite/')[1]!;
    expect((await as(t, bob, `/v1/invitations/${token}/accept`, { method: 'POST' })).status).toBe(
      200,
    );
    annPersonal = await personal(ann);
    bobPersonal = await personal(bob);
  });
  afterAll(async () => {
    await t.app.close();
    await provider.close();
  });

  async function personal(s: Session): Promise<string> {
    const body = (await (await as(t, s, '/v1/workspaces')).json()) as {
      workspaces: { id: string; kind: string }[];
    };
    return body.workspaces.find((w) => w.kind === 'personal')!.id;
  }

  const draft = (workspaceId: string, extra: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(),
    workspaceId,
    kind: 'expense',
    amountMinor: 1250,
    currency: 'EUR',
    occurredOn: '2026-10-01',
    accountId: null,
    categoryId: null,
    description: 'Bread',
    note: '',
    ...extra,
  });
  type Draft = ReturnType<typeof draft>;

  const upsert = (
    transaction: Draft,
    baseVersion: number | null = null,
    mutationId = crypto.randomUUID(),
  ) => ({
    mutationId,
    type: 'transaction.upsert',
    baseVersion,
    transaction,
  });
  const remove = (transactionId: string, baseVersion: number) => ({
    mutationId: crypto.randomUUID(),
    type: 'transaction.delete',
    transactionId,
    baseVersion,
  });

  async function push(s: Session, ...mutations: unknown[]): Promise<Result[]> {
    const response = await as(t, s, '/v1/sync/push', { method: 'POST', body: { mutations } });
    expect(response.status).toBe(200);
    return ((await response.json()) as { results: Result[] }).results;
  }
  async function pull(s: Session, cursor = 0, limit?: number): Promise<Pull> {
    const query = `cursor=${cursor}${limit ? `&limit=${limit}` : ''}`;
    const response = await as(t, s, `/v1/sync/pull?${query}`);
    expect(response.status).toBe(200);
    return (await response.json()) as Pull;
  }
  async function account(s: Session, workspaceId: string, name = 'Card') {
    const response = await as(t, s, '/v1/accounts', {
      method: 'POST',
      body: { workspaceId, name, kind: 'card', currency: 'EUR' },
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }
  const serverRow = async (id: string) =>
    (await t.db.select().from(transactions).where(eq(transactions.id, id)))[0]!;

  it('creates, updates and deletes through push', async () => {
    const tx = draft(annPersonal);
    const [created] = await push(ann, upsert(tx));
    expect(created).toMatchObject({
      status: 'applied',
      transaction: {
        id: tx.id,
        scope: 'personal',
        version: 1,
        baseAmountMinor: 1250,
        fx: null,
        source: 'manual',
        reviewStatus: 'confirmed',
        author: { userId: ann.userId, displayName: 'Ann' },
      },
    });
    const [updated] = await push(ann, upsert({ ...tx, amountMinor: 999, note: 'n' }, 1));
    expect(updated!.transaction).toMatchObject({ amountMinor: 999, note: 'n', version: 2 });
    const [deleted] = await push(ann, remove(tx.id, 2));
    expect(deleted).toMatchObject({
      status: 'applied',
      transaction: { id: tx.id, deletedAt: expect.any(String) },
    });
    const [again] = await push(ann, remove(tx.id, 1));
    expect(again!.status).toBe('applied');
    expect((await serverRow(tx.id)).deletedAt).not.toBeNull();
  });

  it('applies a replayed mutation once and answers it with a fresh view', async () => {
    const tx = draft(annPersonal);
    const mutation = upsert(tx);
    const [first] = await push(ann, mutation);
    await push(ann, upsert({ ...tx, note: 'later' }, 1));
    const [replay] = await push(ann, mutation);
    expect(replay).toMatchObject({ status: 'applied', transaction: { note: 'later', version: 2 } });
    expect(first!.transaction!.version).toBe(1);
    expect(await t.db.select().from(transactions)).toHaveLength(1);
    expect(await t.db.select().from(syncMutations)).toHaveLength(2);

    const [stolen] = await push(bob, mutation);
    expect(stolen).toMatchObject({ status: 'rejected', code: 'MUTATION_ID_REUSED' });
  });

  it('prunes old mutation outcomes, after which a replay neither duplicates nor overwrites', async () => {
    const tx = draft(annPersonal);
    const created = upsert(tx);
    const edited = upsert({ ...tx, note: 'mine' }, 1);
    const gone = draft(annPersonal);
    const goneCreated = upsert(gone);
    await push(ann, created, edited, goneCreated);
    const removed = { ...remove(gone.id, 1) };
    await push(ann, removed);
    await push(ann, upsert({ ...tx, note: 'other device' }, 2));
    await t.db.execute(sql`update sync_mutations set created_at = now() - interval '181 days'`);
    const fresh = upsert(draft(annPersonal));
    await push(ann, fresh);

    expect(await t.app.get(SyncService).pruneMutations()).toBe(5);
    expect((await t.db.select().from(syncMutations)).map((m) => m.id)).toEqual([fresh.mutationId]);

    const replays = await push(ann, created, edited, goneCreated, removed);
    expect(replays.map((r) => r.status)).toEqual(['conflict', 'conflict', 'conflict', 'applied']);
    expect(await t.db.select().from(transactions)).toHaveLength(3);
    expect(await serverRow(tx.id)).toMatchObject({ note: 'other device', version: 3 });
    expect((await serverRow(gone.id)).deletedAt).not.toBeNull();
  });

  it('prunes resolved conflicts after 180 days and keeps open ones', async () => {
    const conflicted = async () => {
      const tx = draft(annPersonal);
      await push(ann, upsert(tx));
      await push(ann, upsert({ ...tx, amountMinor: 2000 }, 1));
      const [conflict] = await push(ann, upsert({ ...tx, description: 'Local' }, 1));
      return conflict!.conflictId!;
    };
    const [old, recent, open] = [await conflicted(), await conflicted(), await conflicted()];
    for (const id of [old, recent]) {
      await as(t, ann, `/v1/sync/conflicts/${id}/resolve`, {
        method: 'POST',
        body: { resolution: 'server' },
      });
    }
    await t.db.execute(
      sql`update sync_conflicts set created_at = now() - interval '200 days',
            resolved_at = now() - interval '181 days' where id = ${old}`,
    );
    await t.db.execute(
      sql`update sync_conflicts set created_at = now() - interval '200 days' where id = ${open}`,
    );

    expect(await t.app.get(SyncService).pruneResolvedConflicts()).toBe(1);
    expect((await t.db.select().from(syncConflicts)).map((c) => c.id).sort()).toEqual(
      [recent, open].sort(),
    );
  });

  it('budgets pushes per user by mutation count, not by request', async () => {
    const pushStatus = (s: Session, mutations: unknown[]) =>
      as(t, s, '/v1/sync/push', { method: 'POST', body: { mutations } }).then((r) => r.status);
    const queue = Array.from({ length: 300 }, () => upsert(draft(annPersonal)));
    expect(await pushStatus(ann, queue.slice(0, 200))).toBe(200);
    expect(await pushStatus(ann, queue.slice(200))).toBe(200);
    const invalid = Array<unknown>(200).fill({});
    for (let used = 300; used < 1900; used += 200) {
      expect(await pushStatus(ann, invalid)).toBe(400);
    }
    expect(await pushStatus(ann, invalid.slice(0, 100))).toBe(400);

    const late = upsert(draft(annPersonal));
    expect(await pushStatus(ann, [late])).toBe(429);
    expect(
      await t.db.select().from(transactions).where(eq(transactions.id, late.transaction.id)),
    ).toEqual([]);
    expect(await pushStatus(bob, [upsert(draft(bobPersonal))])).toBe(200);
  });

  it('stops applying a push once its client has gone', async () => {
    const slow = sql.raw(`create function zz_slow() returns trigger language plpgsql as $$
      begin perform pg_sleep(0.05); return new; end $$;
      create trigger zz_slow before insert on sync_mutations
      for each row execute function zz_slow();`);
    await t.db.execute(slow);
    try {
      const mutations = Array.from({ length: 100 }, () => upsert(draft(annPersonal)));
      const request = fetch(`${t.baseUrl}/api/v1/sync/push`, {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE}=${ann.cookie}`,
          'x-csrf-token': ann.csrf,
          origin: TEST_APP_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ mutations }),
        signal: AbortSignal.timeout(300),
      });
      await expect(request).rejects.toThrow();
      const stored = async () => (await t.db.select().from(syncMutations)).length;
      await new Promise((resolve) => setTimeout(resolve, 500));
      const afterAbort = await stored();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(await stored()).toBe(afterAbort);
      expect(afterAbort).toBeLessThan(100);
    } finally {
      await t.db.execute(
        sql.raw('drop trigger zz_slow on sync_mutations; drop function zz_slow();'),
      );
    }
  });

  it('answers part of a push that runs past its time budget, leaving the rest for the client', async () => {
    const mutations = [draft(annPersonal), draft(annPersonal), draft(annPersonal)].map((tx) =>
      upsert(tx),
    );
    const sync = t.app.get(SyncService);
    const first = await sync.push(ann.userId, mutations as never, undefined, 0);
    expect(first.map((r) => r.mutationId)).toEqual([mutations[0]!.mutationId]);
    const rest = await push(ann, ...mutations);
    expect(rest.map((r) => r.status)).toEqual(['applied', 'applied', 'applied']);
    expect(await t.db.select().from(transactions)).toHaveLength(3);
  });

  it('keeps every mutation of a batch independent', async () => {
    const ok = draft(annPersonal);
    const results = await push(ann, upsert(draft(bobPersonal)), upsert(ok));
    expect(results.map((r) => r.status)).toEqual(['rejected', 'applied']);
    expect(results[0]!.code).toBe('NOT_FOUND');
  });

  it('records a conflict from a stale device and leaves the server row alone', async () => {
    const tx = draft(annPersonal);
    await push(ann, upsert(tx));
    await push(ann, upsert({ ...tx, amountMinor: 2000 }, 1));
    const [stale] = await push(ann, upsert({ ...tx, description: 'Cake' }, 1));
    expect(stale).toMatchObject({
      status: 'conflict',
      transaction: { amountMinor: 2000, version: 2 },
    });
    expect(await serverRow(tx.id)).toMatchObject({
      amountMinor: 2000,
      description: 'Bread',
      version: 2,
    });

    const [sameAsServer] = await push(ann, upsert({ ...tx, amountMinor: 2000 }, 1));
    expect(sameAsServer!.status).toBe('applied');
    const [refreshed] = await push(ann, upsert({ ...tx, description: 'Pie' }, 1));
    expect(refreshed!.conflictId).toBe(stale!.conflictId);
    const [staleDelete] = await push(ann, remove(tx.id, 1));
    expect(staleDelete!.status).toBe('conflict');
    const [missingBase] = await push(ann, upsert({ ...tx, note: 'x' }, null));
    expect(missingBase!.status).toBe('conflict');

    const { conflicts } = await pull(ann);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      id: stale!.conflictId,
      local: { note: 'x' },
      server: { version: 2 },
    });
    expect(await t.db.select().from(syncConflicts)).toHaveLength(1);
  });

  it('records conflicts between two family members and counts only the server row', async () => {
    const tx = draft(family, { currency: 'EUR', amountMinor: 5000 });
    await push(ann, upsert(tx));
    await push(ann, upsert({ ...tx, amountMinor: 6000 }, 1));
    const [bobEdit] = await push(bob, upsert({ ...tx, amountMinor: 7000 }, 1));
    expect(bobEdit!.status).toBe('conflict');
    expect((await pull(ann)).conflicts).toEqual([]);
    expect((await pull(bob)).conflicts).toHaveLength(1);

    const { rows } = await t.db.execute<{ total: string }>(
      sql`select sum(base_amount_minor)::text as total from transactions where deleted_at is null`,
    );
    expect(rows[0]!.total).toBe('6000');
    const history = (await (await as(t, bob, '/v1/transactions')).json()) as {
      transactions: Row[];
    };
    expect(history.transactions.map((r) => r.amountMinor)).toEqual([6000]);
    for (const member of [ann, bob]) {
      const response = await as(
        t,
        member,
        '/v1/analytics/summary?from=2026-10-01&to=2026-10-31&scope=family',
      );
      const { totals } = (await response.json()) as { totals: { expenseMinor: number } };
      expect(totals.expenseMinor).toBe(6000);
    }
  });

  it('resolves conflicts with the server, local or merged version', async () => {
    const make = async () => {
      const tx = draft(annPersonal);
      await push(ann, upsert(tx));
      await push(ann, upsert({ ...tx, amountMinor: 2000 }, 1));
      const [conflict] = await push(ann, upsert({ ...tx, description: 'Local' }, 1));
      return { tx, id: conflict!.conflictId! };
    };
    const resolve = (s: Session, id: string, body: unknown) =>
      as(t, s, `/v1/sync/conflicts/${id}/resolve`, { method: 'POST', body });

    const server = await make();
    expect((await resolve(bob, server.id, { resolution: 'server' })).status).toBe(404);
    const kept = await resolve(ann, server.id, { resolution: 'server' });
    expect(await kept.json()).toMatchObject({
      status: 'resolved',
      resolution: 'server',
      transaction: { amountMinor: 2000, description: 'Bread', version: 2 },
    });

    const local = await make();
    const applied = await resolve(ann, local.id, { resolution: 'local' });
    expect(await applied.json()).toMatchObject({
      resolution: 'local',
      transaction: { amountMinor: 1250, description: 'Local', version: 3 },
    });
    const replay = await resolve(ann, local.id, { resolution: 'server' });
    expect(await replay.json()).toMatchObject({ resolution: 'local', transaction: { version: 3 } });

    const merged = await make();
    expect((await resolve(ann, merged.id, { resolution: 'merged' })).status).toBe(400);
    expect(
      (await resolve(ann, merged.id, { resolution: 'merged', transaction: draft(annPersonal) }))
        .status,
    ).toBe(400);
    const mergedBody = await (
      await resolve(ann, merged.id, {
        resolution: 'merged',
        transaction: { ...merged.tx, amountMinor: 2000, description: 'Local' },
      })
    ).json();
    expect(mergedBody).toMatchObject({
      transaction: { amountMinor: 2000, description: 'Local', version: 3 },
    });
    expect((await as(t, ann, '/v1/sync/conflicts')).status).toBe(200);
    const open = (await (await as(t, ann, '/v1/sync/conflicts')).json()) as {
      conflicts: unknown[];
    };
    expect(open.conflicts).toEqual([]);
  });

  it('enforces visibility and authorship on every write', async () => {
    const annRow = draft(annPersonal);
    const familyRow = draft(family);
    await push(ann, upsert(annRow), upsert(familyRow));

    const results = await push(
      bob,
      upsert(draft(annPersonal)),
      upsert({ ...annRow, workspaceId: bobPersonal }, 1),
      upsert({ ...annRow, note: 'mine now' }, 1),
      remove(annRow.id, 1),
      upsert({ ...familyRow, workspaceId: bobPersonal }, 1),
    );
    expect(results.map((r) => r.code)).toEqual([
      'NOT_FOUND',
      'NOT_FOUND',
      'NOT_FOUND',
      'NOT_FOUND',
      'FORBIDDEN',
    ]);
    expect(await serverRow(annRow.id)).toMatchObject({
      workspaceId: annPersonal,
      note: '',
      version: 1,
    });

    const [edit] = await push(bob, upsert({ ...familyRow, note: 'shared' }, 1));
    expect(edit).toMatchObject({
      status: 'applied',
      transaction: { author: { userId: ann.userId } },
    });
    const [moved] = await push(
      ann,
      upsert({ ...familyRow, note: 'shared', workspaceId: annPersonal }, 2),
    );
    expect(moved!.transaction).toMatchObject({ scope: 'personal', workspaceId: annPersonal });

    const [catAttempt] = await push(cat, upsert({ ...familyRow }, 3));
    expect(catAttempt!.code).toBe('NOT_FOUND');
  });

  it('sends a tombstone to members when the author moves a family row away', async () => {
    const row = draft(family);
    await push(ann, upsert(row));
    const before = await pull(bob);
    const [bobEdit] = await push(bob, upsert({ ...row, note: 'stale' }, null));
    expect(bobEdit!.status).toBe('conflict');
    expect((await pull(bob)).conflicts).toHaveLength(1);

    await push(ann, upsert({ ...row, workspaceId: annPersonal }, 1));
    const after = await pull(bob, before.cursor);
    expect(after.transactions).toEqual([
      {
        id: row.id,
        workspaceId: family,
        deletedAt: expect.any(String),
        revision: expect.any(Number),
      },
    ]);
    expect(after.conflicts).toEqual([]);
    expect(await t.db.select().from(syncConflicts)).toEqual([]);
    expect((await pull(ann, before.cursor)).transactions[0]).toMatchObject({
      id: row.id,
      scope: 'personal',
    });
    const [bobAgain] = await push(bob, upsert({ ...row, note: 'x' }, 2));
    expect(bobAgain!.code).toBe('NOT_FOUND');
  });

  it('tells members about a move once and nothing about later edits elsewhere (BR-2)', async () => {
    const { url } = (await (
      await as(t, ann, '/v1/family/invitations', { method: 'POST', body: {} })
    ).json()) as { url: string };
    await as(t, cat, `/v1/invitations/${url.split('/invite/')[1]}/accept`, { method: 'POST' });
    const row = draft(family);
    await push(ann, upsert(row));
    const bobStart = await pull(bob);
    const catStart = await pull(cat);

    await push(ann, upsert({ ...row, workspaceId: annPersonal }, 1));
    const tombstone = {
      id: row.id,
      workspaceId: family,
      deletedAt: expect.any(String),
      revision: expect.any(Number),
    };
    const bobMoved = await pull(bob, bobStart.cursor);
    expect(bobMoved.transactions).toEqual([tombstone]);

    let version = 2;
    for (const note of ['one', 'two', 'three']) {
      const [edit] = await push(ann, upsert({ ...row, workspaceId: annPersonal, note }, version));
      expect(edit!.status).toBe('applied');
      version = edit!.transaction!.version;
    }
    const bobAfterEdits = await pull(bob, bobMoved.cursor);
    expect(bobAfterEdits.transactions).toEqual([]);
    expect(bobAfterEdits.cursor).toBe(bobMoved.cursor);
    expect((await pull(cat, catStart.cursor)).transactions).toEqual([tombstone]);
    expect((await pull(bob)).transactions.filter((r) => r.id === row.id)).toEqual([tombstone]);

    const [bobUser] = await t.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'Bob@example.test'));
    const transfer = { method: 'POST', body: { userId: bobUser!.id } } as const;
    expect((await as(t, ann, '/v1/family/transfer', transfer)).status).toBe(200);
    expect((await as(t, ann, '/v1/family/leave', { method: 'POST' })).status).toBe(204);
    await push(ann, upsert({ ...row, workspaceId: annPersonal, note: 'after leaving' }, version));
    expect((await pull(bob, bobMoved.cursor)).transactions).toEqual([]);
    expect(await t.db.select().from(syncTombstones)).toHaveLength(1);
  });

  it('pulls a row moved back as live, without its old tombstone', async () => {
    const row = draft(family);
    await push(ann, upsert(row));
    await push(ann, upsert({ ...row, workspaceId: annPersonal }, 1));
    const bobMoved = await pull(bob);
    expect(bobMoved.transactions.filter((r) => r.id === row.id)).toHaveLength(1);
    await push(ann, upsert(row, 2));
    const back = await pull(bob, bobMoved.cursor);
    expect(back.transactions).toEqual([expect.objectContaining({ id: row.id, scope: 'family' })]);
    expect((await pull(bob)).transactions.filter((r) => r.id === row.id)).toEqual([
      expect.objectContaining({ scope: 'family' }),
    ]);
    expect((await pull(ann)).transactions.filter((r) => r.id === row.id)).toEqual([
      expect.objectContaining({ scope: 'family' }),
    ]);
  });

  it('applies BR-3 and BR-4 to references', async () => {
    const annCard = await account(ann, annPersonal);
    const familyAccount = await account(ann, family, 'Joint');
    const bobCard = await account(bob, bobPersonal);
    const row = draft(family, { accountId: annCard });
    const [created] = await push(ann, upsert(row));
    expect(created!.transaction!.accountId).toBe(annCard);

    const bobView = (await pull(bob)).transactions.find((r) => r.id === row.id)!;
    expect(bobView.accountId).toBeNull();
    const [bobEdit] = await push(bob, upsert({ ...row, accountId: null, note: 'hi' }, 1));
    expect(bobEdit!.transaction!.accountId).toBeNull();
    expect((await serverRow(row.id)).accountId).toBe(annCard);

    const refs = await push(
      bob,
      upsert(draft(family, { accountId: annCard })),
      upsert(draft(family, { accountId: bobCard })),
      upsert(draft(family, { accountId: familyAccount })),
      upsert(draft(annPersonal, { accountId: bobCard })),
    );
    expect(refs.map((r) => r.code ?? r.status)).toEqual([
      'INVALID_ACCOUNT',
      'applied',
      'applied',
      'NOT_FOUND',
    ]);

    await as(t, ann, `/v1/accounts/${familyAccount}`, {
      method: 'PATCH',
      body: { archived: true },
    });
    const [archived] = await push(ann, upsert(draft(family, { accountId: familyAccount })));
    expect(archived!.code).toBe('INVALID_ACCOUNT');

    const categories = (await (
      await as(t, ann, `/v1/categories?workspaceId=${family}`)
    ).json()) as {
      categories: { id: string; kind: string; systemKey: string }[];
    };
    const salary = categories.categories.find((c) => c.systemKey === 'salary')!;
    const groceries = categories.categories.find((c) => c.systemKey === 'groceries')!;
    const annCategories = (await (
      await as(t, ann, `/v1/categories?workspaceId=${annPersonal}`)
    ).json()) as {
      categories: { id: string; systemKey: string }[];
    };
    const personalGroceries = annCategories.categories.find((c) => c.systemKey === 'groceries')!;
    const categorized = await push(
      ann,
      upsert(draft(family, { categoryId: groceries.id })),
      upsert(draft(family, { categoryId: salary.id })),
      upsert(draft(family, { categoryId: personalGroceries.id })),
    );
    expect(categorized.map((r) => r.code ?? r.status)).toEqual([
      'applied',
      'INVALID_CATEGORY',
      'INVALID_CATEGORY',
    ]);
  });

  it('refuses to edit rows waiting for import review but still pulls them', async () => {
    const tx = draft(annPersonal);
    await push(ann, upsert(tx));
    await t.db
      .update(transactions)
      .set({ reviewStatus: 'pending_review' })
      .where(eq(transactions.id, tx.id));
    const [edit] = await push(ann, upsert({ ...tx, note: 'x' }, 1));
    expect(edit!.code).toBe('REVIEW_REQUIRED');
    expect((await pull(ann)).transactions.find((r) => r.id === tx.id)).toMatchObject({
      reviewStatus: 'pending_review',
    });
  });

  it("never pulls another member's personal data", async () => {
    await account(ann, annPersonal);
    await account(ann, family, 'Joint');
    await push(ann, upsert(draft(annPersonal)), upsert(draft(family)));
    const view = await pull(bob);
    const visible = new Set([bobPersonal, family]);
    expect(view.workspaces.map((w) => w.id).sort()).toEqual([...visible].sort());
    for (const list of [view.accounts, view.categories, view.transactions]) {
      expect(list.length).toBeGreaterThan(0);
      for (const item of list) expect(visible.has(item.workspaceId as string)).toBe(true);
    }
    expect(view.transactions).toHaveLength(1);
  });

  it('pages through all three tables without skipping or repeating rows', async () => {
    for (let i = 0; i < 3; i += 1) await account(ann, annPersonal, `Account ${i}`);
    await push(ann, ...Array.from({ length: 5 }, () => upsert(draft(annPersonal))));
    await account(ann, annPersonal, 'Late');
    const full = await pull(ann);
    expect(full.hasMore).toBe(false);
    const expected = [...full.accounts, ...full.categories, ...full.transactions].map((r) => r.id);

    for (const limit of [1, 2, 3, 7]) {
      const seen: string[] = [];
      let cursor = 0;
      for (let page = 0; page < 200; page += 1) {
        const view = await pull(ann, cursor, limit);
        seen.push(...[...view.accounts, ...view.categories, ...view.transactions].map((r) => r.id));
        expect(view.cursor).toBeGreaterThanOrEqual(cursor);
        cursor = view.cursor;
        if (!view.hasMore) break;
      }
      expect(seen.sort(), `limit ${limit}`).toEqual([...expected].sort());
    }
    expect((await pull(ann, full.cursor)).transactions).toEqual([]);
    expect((await pull(ann, full.cursor)).cursor).toBe(full.cursor);
  });

  it('after a restore, gives devices a new epoch and revisions past their cursor', async () => {
    await push(ann, upsert(draft(annPersonal)));
    const before = await pull(ann);
    expect(before.epoch).toMatch(/^[0-9a-f-]{36}$/);
    // What pg_restore leaves behind: the sequence as of the dump, behind every device's cursor.
    await t.db.execute(sql`select setval('ledger_revision', 1)`);
    const script = readFileSync(resolve(__dirname, '../../../deploy/after-restore.sql'), 'utf8');
    await t.db.execute(sql.raw(script));

    const [later] = await push(ann, upsert(draft(annPersonal)));
    const after = await pull(ann, before.cursor);
    expect(after.epoch).not.toBe(before.epoch);
    expect(after.transactions.map((row) => row.id)).toEqual([later!.transaction!.id]);
  });

  it('answers a write stuck behind the ledger lock with a retryable 503', async () => {
    const holder = new Client({ connectionString: testDatabaseUrl });
    await holder.connect();
    try {
      await holder.query('begin');
      await holder.query('select pg_advisory_xact_lock(7302001)');
      const response = await as(t, ann, '/v1/sync/push', {
        method: 'POST',
        body: { mutations: [upsert(draft(annPersonal))] },
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: 'UNAVAILABLE' } });
    } finally {
      await holder.query('rollback');
      await holder.end();
    }
    expect(await t.db.select().from(transactions)).toEqual([]);
  }, 30_000);

  it('validates push bodies and pull cursors', async () => {
    const bad = await as(t, ann, '/v1/sync/push', { method: 'POST', body: { mutations: [] } });
    expect(bad.status).toBe(400);
    expect((await as(t, ann, '/v1/sync/pull?cursor=-1')).status).toBe(400);
    expect((await as(t, ann, '/v1/sync/pull?limit=1001')).status).toBe(400);
    const withoutCsrf = await fetch(`${t.baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        cookie: `__Host-spending_session=${ann.cookie}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ mutations: [upsert(draft(annPersonal))] }),
    });
    expect(withoutCsrf.status).toBe(403);
    expect(await t.db.select().from(accounts)).toEqual([]);
  });
});
