import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { todayIn } from '../src/common/dates';
import { recurringRules, transactions } from '../src/database/schema';
import { RecurringService } from '../src/recurring/recurring.service';
import { occurrences } from '../src/recurring/schedule';
import { type FakeOidc, startFakeOidc } from './fake-oidc/server';
import {
  as,
  categoriesOf,
  createFamily,
  loginAs,
  pushDelete,
  resetData,
  type Session,
  startTestApp,
  TEST_CLIENT,
  type TestApp,
  workspacesOf,
} from './harness';

const person = (name: string) => ({ sub: `sub-${name}`, email: `${name}@example.test`, name });
const people = [person('Ann'), person('Bob'), person('Cid')] as const;

type Rule = {
  id: string;
  workspaceId: string;
  scope: string;
  accountId: string | null;
  amountMinor: number;
  description: string;
  timezone: string;
  nextOccurrence: string | null;
  pausedAt: string | null;
};

describe('recurring rules', () => {
  let provider: FakeOidc;
  let t: TestApp;
  let recurring: RecurringService;
  let ann: Session;
  let bob: Session;
  let cid: Session;
  let annPersonal: string;
  let family: string;
  let familyCategories: Record<string, string>;

  beforeAll(async () => {
    provider = await startFakeOidc({ users: people, clients: [TEST_CLIENT] });
    t = await startTestApp({ OIDC_ISSUER: provider.issuer });
    recurring = t.app.get(RecurringService);
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
  const create = (s: Session, body: Record<string, unknown>) =>
    as(t, s, '/v1/recurring-rules', {
      method: 'POST',
      body: {
        workspaceId: annPersonal,
        kind: 'expense',
        amountMinor: 1_000,
        currency: 'EUR',
        frequency: 'monthly',
        startsOn: '2030-01-31',
        timezone: 'Europe/Madrid',
        ...body,
      },
    });
  const patch = (s: Session, id: string, body: Record<string, unknown>) =>
    as(t, s, `/v1/recurring-rules/${id}`, { method: 'PATCH', body });
  const generated = (ruleId: string) =>
    t.db
      .select()
      .from(transactions)
      .where(eq(transactions.recurringRuleId, ruleId))
      .orderBy(asc(transactions.occurredOn));
  const errorCode = async (response: Response) =>
    ((await response.json()) as { error: { code: string } }).error.code;

  it('catches up every missed month once, clamped to month ends (BR-23)', async () => {
    const rule = await json<Rule>(await create(ann, {}), 201);
    expect(rule).toMatchObject({ scope: 'personal', nextOccurrence: '2030-01-31' });
    expect(await recurring.runDue(new Date('2030-01-30T12:00:00Z'))).toBe(0);

    expect(await recurring.runDue(new Date('2030-04-30T12:00:00Z'))).toBe(4);
    const rows = await generated(rule.id);
    expect(rows.map((r) => r.occurredOn)).toEqual([
      '2030-01-31',
      '2030-02-28',
      '2030-03-31',
      '2030-04-30',
    ]);
    expect(rows[0]).toMatchObject({
      workspaceId: annPersonal,
      createdBy: ann.userId,
      source: 'recurring',
      recurringOccurrence: '2030-01-31',
      baseAmountMinor: 1_000,
      reviewStatus: 'confirmed',
    });
    const [stored] = await t.db.select().from(recurringRules).where(eq(recurringRules.id, rule.id));
    expect(stored!.nextOccurrence).toBe('2030-05-31');
  });

  it('is idempotent when run twice or concurrently', async () => {
    const rule = await json<Rule>(await create(ann, { frequency: 'daily' }), 201);
    const now = new Date('2030-02-09T12:00:00Z');
    const counts = await Promise.all([recurring.runDue(now), recurring.runDue(now)]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(await recurring.runDue(now)).toBe(0);
    await t.db
      .update(recurringRules)
      .set({ nextOccurrence: '2030-01-31' })
      .where(eq(recurringRules.id, rule.id));
    expect(await recurring.runDue(now)).toBe(0);
    expect(await generated(rule.id)).toHaveLength(10);
  });

  it('does not recreate a deleted occurrence', async () => {
    const rule = await json<Rule>(await create(ann, {}), 201);
    await recurring.runDue(new Date('2030-02-28T12:00:00Z'));
    const [first] = await generated(rule.id);
    await pushDelete(t, ann, { id: first!.id, version: first!.version });
    await t.db
      .update(recurringRules)
      .set({ nextOccurrence: '2030-01-31' })
      .where(eq(recurringRules.id, rule.id));
    expect(await recurring.runDue(new Date('2030-02-28T12:00:00Z'))).toBe(0);
    const rows = await generated(rule.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.deletedAt).not.toBeNull();
  });

  it('pauses, resumes and applies edits to future occurrences only (BR-24)', async () => {
    const rule = await json<Rule>(await create(ann, {}), 201);
    await recurring.runDue(new Date('2030-02-28T12:00:00Z'));

    const paused = await json<Rule>(await patch(ann, rule.id, { paused: true }), 200);
    expect(paused.pausedAt).not.toBeNull();
    expect(await recurring.runDue(new Date('2030-06-30T12:00:00Z'))).toBe(0);
    const resumed = await json<Rule>(
      await patch(ann, rule.id, { paused: false, amountMinor: 2_500, description: 'Rent' }),
      200,
    );
    expect(resumed).toMatchObject({ pausedAt: null, nextOccurrence: '2030-03-31' });
    expect(await recurring.runDue(new Date('2030-03-31T12:00:00Z'))).toBe(1);
    expect((await generated(rule.id)).map((r) => [r.amountMinor, r.description])).toEqual([
      [1_000, ''],
      [1_000, ''],
      [2_500, 'Rent'],
    ]);
  });

  it('generates due occurrences on create and keeps them when the rule is deleted', async () => {
    const zone = 'America/New_York';
    const rule = await json<Rule>(
      await create(ann, { frequency: 'weekly', startsOn: '2026-01-05', timezone: zone }),
      201,
    );
    const today = todayIn(new Date(), zone);
    const expected = occurrences(
      { frequency: 'weekly', interval: 1, startsOn: '2026-01-05', endsOn: null },
      '2026-01-05',
      today,
    );
    expect((await generated(rule.id)).map((r) => r.occurredOn)).toEqual(expected);
    expect(rule.nextOccurrence! > today).toBe(true);

    expect((await as(t, ann, `/v1/recurring-rules/${rule.id}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    const kept = await t.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.source, 'recurring'), isNull(transactions.deletedAt)));
    expect(kept).toHaveLength(expected.length);
    expect(kept.every((r) => r.recurringRuleId === null)).toBe(true);
  });

  it('ends at endsOn and defaults the time zone to the user’s', async () => {
    await as(t, ann, '/v1/me', { method: 'PATCH', body: { timezone: 'Asia/Tokyo' } });
    const rule = await json<Rule>(
      await create(ann, { timezone: undefined, startsOn: '2030-01-15', endsOn: '2030-02-20' }),
      201,
    );
    expect(rule.timezone).toBe('Asia/Tokyo');
    expect(await recurring.runDue(new Date('2030-12-01T00:00:00Z'))).toBe(2);
    const [stored] = await t.db.select().from(recurringRules).where(eq(recurringRules.id, rule.id));
    expect(stored!.nextOccurrence).toBeNull();
  });

  it('validates the template and schedule', async () => {
    const reject = async (body: Record<string, unknown>, status: number, code: string) => {
      const response = await create(ann, body);
      expect(response.status).toBe(status);
      expect(await errorCode(response)).toBe(code);
    };
    const personal = await categoriesOf(t, ann, annPersonal);
    await reject({ categoryId: personal.salary }, 422, 'INVALID_CATEGORY');
    await reject({ categoryId: familyCategories.groceries }, 422, 'INVALID_CATEGORY');
    await reject({ accountId: crypto.randomUUID() }, 422, 'INVALID_ACCOUNT');
    await reject({ endsOn: '2030-01-30' }, 400, 'VALIDATION_FAILED');
    await reject({ interval: 0 }, 400, 'VALIDATION_FAILED');
    await reject({ interval: 367 }, 400, 'VALIDATION_FAILED');
    await reject({ amountMinor: -5 }, 400, 'VALIDATION_FAILED');
    await reject({ frequency: 'hourly' }, 400, 'VALIDATION_FAILED');
    await reject({ timezone: 'Mars/Olympus' }, 400, 'VALIDATION_FAILED');
    const rule = await json<Rule>(await create(ann, { endsOn: '2030-03-01' }), 201);
    expect((await patch(ann, rule.id, { startsOn: '2030-04-01' })).status).toBe(400);
  });

  it('shares family rules with members only and hides personal ones (BR-2, BR-3)', async () => {
    const { id: card } = await json<{ id: string }>(
      await as(t, ann, '/v1/accounts', {
        method: 'POST',
        body: { workspaceId: annPersonal, name: 'Visa', kind: 'card', currency: 'EUR' },
      }),
      201,
    );
    const shared = await json<Rule>(
      await create(ann, {
        workspaceId: family,
        accountId: card,
        categoryId: familyCategories.housing,
      }),
      201,
    );
    const personal = await json<Rule>(await create(ann, {}), 201);
    expect(shared).toMatchObject({ scope: 'family', accountId: card });

    const list = async (s: Session) =>
      (await json<{ rules: Rule[] }>(await as(t, s, '/v1/recurring-rules'), 200)).rules;
    expect((await list(ann)).map((r) => r.id)).toEqual([shared.id, personal.id]);
    expect(await list(bob)).toEqual([expect.objectContaining({ id: shared.id, accountId: null })]);
    expect(await list(cid)).toEqual([]);
    expect((await as(t, bob, `/v1/recurring-rules?workspaceId=${annPersonal}`)).status).toBe(404);

    const edited = await json<Rule>(
      await patch(bob, shared.id, { description: 'Rent', accountId: null }),
      200,
    );
    expect(edited).toMatchObject({ description: 'Rent', accountId: null });
    expect((await list(ann))[0]).toMatchObject({ description: 'Rent', accountId: card });
    const { id: cash } = await json<{ id: string }>(
      await as(t, ann, '/v1/accounts', {
        method: 'POST',
        body: { workspaceId: annPersonal, name: 'Cash', kind: 'cash', currency: 'EUR' },
      }),
      201,
    );
    expect(await errorCode(await patch(bob, shared.id, { accountId: cash }))).toBe(
      'INVALID_ACCOUNT',
    );
    expect((await patch(ann, shared.id, { accountId: cash })).status).toBe(200);

    expect((await patch(bob, personal.id, { amountMinor: 1 })).status).toBe(404);
    expect((await patch(cid, shared.id, { amountMinor: 1 })).status).toBe(404);
    for (const [s, id] of [
      [bob, personal.id],
      [cid, shared.id],
    ] as const) {
      expect((await as(t, s, `/v1/recurring-rules/${id}`, { method: 'DELETE' })).status).toBe(404);
    }
    expect(
      (await create(cid, { workspaceId: family, categoryId: familyCategories.housing })).status,
    ).toBe(404);
  });
});
