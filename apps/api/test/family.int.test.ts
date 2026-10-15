import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  accounts,
  categories,
  invitations,
  memberships,
  syncConflicts,
  transactions,
  workspaces,
} from '../src/database/schema';
import { AccessPolicy } from '../src/workspaces/access-policy';
import { type FakeOidc, startFakeOidc } from './fake-oidc/server';
import {
  as,
  loginAs,
  resetData,
  type Session,
  startTestApp,
  TEST_APP_ORIGIN,
  TEST_CLIENT,
  type TestApp,
} from './harness';

const person = (name: string) => ({
  sub: `sub-${name}`,
  email: `${name.toLowerCase()}@example.test`,
  name,
});
const people = [person('Ann'), person('Bob'), person('Cat'), person('Dan')] as const;

type Workspace = {
  id: string;
  kind: 'personal' | 'family';
  name: string;
  role: string;
  members: { userId: string; role: string }[];
};

describe('family workspaces', () => {
  let provider: FakeOidc;
  let t: TestApp;
  let ann: Session;
  let bob: Session;
  let cat: Session;
  let dan: Session;

  beforeAll(async () => {
    provider = await startFakeOidc({ users: people, clients: [TEST_CLIENT] });
    t = await startTestApp({ OIDC_ISSUER: provider.issuer });
  });
  beforeEach(async () => {
    await resetData(t.db);
    [ann, bob, cat, dan] = await Promise.all([
      loginAs(t, people[0].sub),
      loginAs(t, people[1].sub),
      loginAs(t, people[2].sub),
      loginAs(t, people[3].sub),
    ]);
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

  const workspacesOf = async (s: Session) =>
    (await json<{ workspaces: Workspace[] }>(await as(t, s, '/v1/workspaces'), 200)).workspaces;
  const personalOf = async (s: Session) =>
    (await workspacesOf(s)).find((w) => w.kind === 'personal')!;

  const createFamily = (s: Session, name = 'Home') =>
    as(t, s, '/v1/family', { method: 'POST', body: { name } });
  const invite = async (s: Session, expiresInDays?: number) => {
    const body = await json<{ id: string; url: string; expiresAt: string }>(
      await as(t, s, '/v1/family/invitations', {
        method: 'POST',
        body: expiresInDays === undefined ? {} : { expiresInDays },
      }),
      201,
    );
    return { ...body, token: body.url.split('/invite/')[1]! };
  };
  const accept = (s: Session, token: string) =>
    as(t, s, `/v1/invitations/${token}/accept`, { method: 'POST' });

  async function familyWith(owner: Session, ...members: Session[]): Promise<Workspace> {
    const family = await json<Workspace>(await createFamily(owner), 201);
    for (const member of members) {
      const { token } = await invite(owner);
      expect((await accept(member, token)).status).toBe(200);
    }
    return family;
  }

  it('seeds default categories into each new workspace exactly once', async () => {
    const personal = await personalOf(ann);
    const seeded = await t.db
      .select()
      .from(categories)
      .where(eq(categories.workspaceId, personal.id));
    expect(seeded).toHaveLength(20);
    expect(seeded.find((c) => c.systemKey === 'groceries')).toMatchObject({
      name: 'Groceries',
      kind: 'expense',
    });
    await loginAs(t, people[0].sub);
    expect(await t.db.select().from(categories)).toHaveLength(80);

    const family = await json<Workspace>(await createFamily(ann), 201);
    const familyCategories = await t.db
      .select()
      .from(categories)
      .where(eq(categories.workspaceId, family.id));
    expect(familyCategories).toHaveLength(20);
  });

  it('runs the invitation lifecycle', async () => {
    const family = await json<Workspace>(await createFamily(ann, '  Home  '), 201);
    expect(family).toMatchObject({ kind: 'family', name: 'Home', role: 'owner' });
    expect(await errorCode(await createFamily(ann))).toBe('FAMILY_EXISTS');

    const invitation = await invite(ann);
    expect(invitation.url).toMatch(new RegExp(`^${TEST_APP_ORIGIN}/invite/[\\w-]{43}$`));
    const [stored] = await t.db.select().from(invitations);
    expect(stored!.tokenHash).not.toContain(invitation.token);
    const lifetime = new Date(invitation.expiresAt).getTime() - Date.now();
    expect(Math.abs(lifetime - 7 * 86_400_000)).toBeLessThan(60_000);

    expect(await json(await as(t, bob, `/v1/invitations/${invitation.token}`), 200)).toEqual({
      familyName: 'Home',
      ownerName: 'Ann',
      expiresAt: invitation.expiresAt,
      state: 'pending',
    });
    const joined = await json<Workspace>(await accept(bob, invitation.token), 200);
    expect(joined).toMatchObject({ id: family.id, role: 'member' });
    expect(joined.members.map((m) => [m.userId, m.role])).toEqual([
      [ann.userId, 'owner'],
      [bob.userId, 'member'],
    ]);

    const replay = await accept(cat, invitation.token);
    expect(replay.status).toBe(410);
    expect(await errorCode(replay)).toBe('INVITATION_INVALID');
    const usedPreview = await as(t, cat, `/v1/invitations/${invitation.token}`);
    expect(usedPreview.status).toBe(410);
    expect(await errorCode(usedPreview)).toBe('INVITATION_INVALID');

    const expired = await invite(ann);
    await t.db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, expired.id));
    const revoked = await invite(ann);
    expect(
      (await as(t, ann, `/v1/family/invitations/${revoked.id}`, { method: 'DELETE' })).status,
    ).toBe(204);
    expect(
      (await as(t, ann, `/v1/family/invitations/${revoked.id}`, { method: 'DELETE' })).status,
    ).toBe(204);
    for (const token of [expired.token, revoked.token, 'x'.repeat(43), 'short']) {
      for (const response of [
        await as(t, cat, `/v1/invitations/${token}`),
        await accept(cat, token),
      ]) {
        expect(response.status).toBe(410);
        expect(await errorCode(response)).toBe('INVITATION_INVALID');
      }
    }

    const pending = await invite(ann, 30);
    const list = await json<{ invitations: { id: string; state: string }[] }>(
      await as(t, ann, '/v1/family/invitations'),
      200,
    );
    expect(Object.fromEntries(list.invitations.map((i) => [i.id, i.state]))).toEqual({
      [invitation.id]: 'accepted',
      [expired.id]: 'expired',
      [revoked.id]: 'revoked',
      [pending.id]: 'pending',
    });
    expect(list.invitations.find((i) => i.id === invitation.id)).toMatchObject({
      acceptedBy: { userId: bob.userId, displayName: 'Bob' },
    });
  });

  it('refuses an invitation to a user already in a family without consuming it', async () => {
    await familyWith(ann, bob);
    await json(await createFamily(dan, 'Dans'), 201);
    const invitation = await invite(dan);
    for (const s of [bob, ann]) {
      const response = await accept(s, invitation.token);
      expect(response.status).toBe(409);
      expect(await errorCode(response)).toBe('FAMILY_EXISTS');
    }
    const [row] = await t.db.select().from(invitations).where(eq(invitations.id, invitation.id));
    expect(row!.acceptedAt).toBeNull();
    expect((await accept(cat, invitation.token)).status).toBe(200);
  });

  it('settles an accept racing the family deletion without errors', async () => {
    await familyWith(ann);
    const { token } = await invite(ann);
    const [accepted, deleted] = await Promise.all([
      accept(bob, token),
      as(t, ann, '/v1/family', { method: 'DELETE', body: { confirmName: 'Home' } }),
    ]);
    expect([200, 410]).toContain(accepted.status);
    expect(deleted.status).toBe(204);
    expect((await workspacesOf(bob)).map((w) => w.kind)).toEqual(['personal']);
  });

  it('keeps a member whose accept commits while the sole owner deletes the account', async () => {
    const family = await familyWith(ann);
    // An accept in flight: it holds the family row `for key share` and has inserted its member.
    const accepting = t.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from workspaces where id = ${family.id} for key share`);
      await tx.insert(memberships).values({
        workspaceId: family.id,
        workspaceKind: 'family',
        userId: bob.userId,
        role: 'member',
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const deleted = await as(t, ann, '/v1/me', {
      method: 'DELETE',
      body: { confirmation: 'DELETE MY DATA' },
    });
    await accepting;
    expect(deleted.status).toBe(409);
    expect(await errorCode(deleted)).toBe('FAMILY_OWNER_MUST_TRANSFER');
    expect(
      await t.db.select().from(memberships).where(eq(memberships.userId, bob.userId)),
    ).toHaveLength(2);
  });

  it('lets two concurrent accepts of one invitation succeed only once', async () => {
    await familyWith(ann);
    const { token } = await invite(ann);
    const statuses = (await Promise.all([accept(bob, token), accept(cat, token)])).map(
      (r) => r.status,
    );
    expect(statuses.sort()).toEqual([200, 410]);
    expect(
      await t.db.select().from(memberships).where(eq(memberships.role, 'member')),
    ).toHaveLength(1);
  });

  it('handles leaving, removal, transfer and the audit log', async () => {
    const family = await familyWith(ann, bob, cat);
    const ownerLeaves = await as(t, ann, '/v1/family/leave', { method: 'POST' });
    expect(ownerLeaves.status).toBe(409);
    expect(await errorCode(ownerLeaves)).toBe('OWNER_CANNOT_LEAVE');
    expect(
      await errorCode(await as(t, ann, `/v1/family/members/${ann.userId}`, { method: 'DELETE' })),
    ).toBe('OWNER_CANNOT_LEAVE');

    expect((await as(t, cat, '/v1/family/leave', { method: 'POST' })).status).toBe(204);
    expect((await workspacesOf(cat)).map((w) => w.kind)).toEqual(['personal']);
    expect((await as(t, cat, '/v1/family/leave', { method: 'POST' })).status).toBe(404);

    expect(
      (await as(t, bob, `/v1/family/members/${ann.userId}`, { method: 'DELETE' })).status,
    ).toBe(403);
    expect(
      (await as(t, ann, `/v1/family/members/${dan.userId}`, { method: 'DELETE' })).status,
    ).toBe(404);
    expect(
      (await as(t, ann, `/v1/family/members/${bob.userId}`, { method: 'DELETE' })).status,
    ).toBe(204);

    const { token } = await invite(ann);
    await accept(dan, token);
    expect(
      (await as(t, ann, '/v1/family/transfer', { method: 'POST', body: { userId: cat.userId } }))
        .status,
    ).toBe(404);
    const transferred = await json<Workspace>(
      await as(t, ann, '/v1/family/transfer', { method: 'POST', body: { userId: dan.userId } }),
      200,
    );
    expect(transferred.role).toBe('member');
    expect(Object.fromEntries(transferred.members.map((m) => [m.userId, m.role]))).toEqual({
      [ann.userId]: 'member',
      [dan.userId]: 'owner',
    });
    const [row] = await t.db.select().from(workspaces).where(eq(workspaces.id, family.id));
    expect(row!.ownerId).toBe(dan.userId);
    expect((await as(t, ann, '/v1/family/leave', { method: 'POST' })).status).toBe(204);

    expect(
      (await as(t, dan, '/v1/family', { method: 'PATCH', body: { name: 'Nest' } })).status,
    ).toBe(200);
    const { events } = await json<{
      events: {
        type: string;
        actor: { userId: string } | null;
        subject: { userId: string } | null;
      }[];
    }>(await as(t, dan, '/v1/family/events'), 200);
    expect(events.map((e) => e.type)).toEqual([
      'renamed',
      'member_left',
      'ownership_transferred',
      'member_joined',
      'invitation_created',
      'member_removed',
      'member_left',
      'member_joined',
      'invitation_created',
      'member_joined',
      'invitation_created',
      'family_created',
    ]);
    expect(events[2]).toMatchObject({
      actor: { userId: ann.userId },
      subject: { userId: dan.userId },
    });
    expect((await as(t, bob, '/v1/family/events')).status).toBe(404);
  });

  it('keeps family management with the owner', async () => {
    await familyWith(ann, bob);
    const ownerInvitation = await invite(ann);
    const attempts: [string, string, unknown?][] = [
      ['POST', '/v1/family/invitations', {}],
      ['GET', '/v1/family/invitations'],
      ['DELETE', `/v1/family/invitations/${ownerInvitation.id}`],
      ['PATCH', '/v1/family', { name: 'Mine' }],
      ['DELETE', '/v1/family', { confirmName: 'Home' }],
      ['POST', '/v1/family/transfer', { userId: bob.userId }],
    ];
    for (const [method, path, body] of attempts) {
      const response = await as(t, bob, path, { method, body });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    const [row] = await t.db
      .select()
      .from(invitations)
      .where(eq(invitations.id, ownerInvitation.id));
    expect(row!.revokedAt).toBeNull();
  });

  it('never exposes another workspace through ids or the access policy', async () => {
    await familyWith(ann, bob);
    await familyWith(cat);
    const catInvitation = await invite(cat);
    const annPersonal = await personalOf(ann);

    expect((await workspacesOf(bob)).map((w) => w.id)).not.toContain(annPersonal.id);
    expect(
      (await as(t, ann, `/v1/family/invitations/${catInvitation.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
    expect(
      (await as(t, ann, `/v1/family/members/${cat.userId}`, { method: 'DELETE' })).status,
    ).toBe(404);
    expect(
      (await as(t, ann, '/v1/family/transfer', { method: 'POST', body: { userId: cat.userId } }))
        .status,
    ).toBe(404);
    expect(
      (await as(t, ann, '/v1/family/invitations/not-a-uuid', { method: 'DELETE' })).status,
    ).toBe(400);

    const policy = t.app.get(AccessPolicy);
    await expect(policy.requireMember(bob.userId, annPersonal.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const catFamily = (await workspacesOf(cat)).find((w) => w.kind === 'family')!;
    await expect(policy.requireMember(ann.userId, catFamily.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const annFamily = (await workspacesOf(ann)).find((w) => w.kind === 'family')!;
    await expect(policy.requireOwner(bob.userId, annFamily.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await policy.personalWorkspaceId(ann.userId)).toBe(annPersonal.id);
    expect((await policy.memberships(bob.userId)).map((m) => m.kind)).toEqual([
      'personal',
      'family',
    ]);
  });

  it('dissolves a family per BR-11', async () => {
    const family = await familyWith(ann, bob, cat);
    const annPersonal = await personalOf(ann);
    const bobPersonal = await personalOf(bob);
    const [familyAccount] = await t.db
      .insert(accounts)
      .values({ workspaceId: family.id, name: 'Joint', kind: 'bank', currency: 'EUR' })
      .returning();
    const [bobCard] = await t.db
      .insert(accounts)
      .values({ workspaceId: bobPersonal.id, name: 'Card', kind: 'card', currency: 'EUR' })
      .returning();
    const [pets] = await t.db
      .insert(categories)
      .values({
        workspaceId: family.id,
        name: 'Pets',
        kind: 'expense',
        color: '#000000',
        icon: 'dog',
      })
      .returning();
    const [familyGroceries] = await t.db
      .select()
      .from(categories)
      .where(and(eq(categories.workspaceId, family.id), eq(categories.systemKey, 'groceries')));
    const [bobGroceries] = await t.db
      .select()
      .from(categories)
      .where(
        and(eq(categories.workspaceId, bobPersonal.id), eq(categories.systemKey, 'groceries')),
      );

    const row = (
      createdBy: string | null,
      extra: Partial<typeof transactions.$inferInsert> = {},
    ) => ({
      id: crypto.randomUUID(),
      workspaceId: family.id,
      createdBy,
      kind: 'expense' as const,
      amountMinor: 1000,
      currency: 'EUR',
      baseAmountMinor: 1000,
      occurredOn: '2026-10-01',
      ...extra,
    });
    const annRow = row(ann.userId, {
      accountId: familyAccount!.id,
      categoryId: familyGroceries!.id,
    });
    const bobRow = row(bob.userId, { accountId: bobCard!.id, categoryId: pets!.id });
    const bobGroceryRow = row(bob.userId, { categoryId: familyGroceries!.id });
    const orphan = row(null);
    const annTombstone = row(ann.userId, { categoryId: pets!.id, deletedAt: new Date() });
    const catRow = row(cat.userId);
    const inserted = await t.db
      .insert(transactions)
      .values([annRow, bobRow, bobGroceryRow, orphan, annTombstone, catRow])
      .returning();
    const conflict = (userId: string) => ({
      transactionId: annRow.id,
      userId,
      baseVersion: 1,
      serverVersion: 1,
      local: {},
      server: {},
    });
    const [annConflict] = await t.db
      .insert(syncConflicts)
      .values([conflict(ann.userId), conflict(bob.userId)])
      .returning();
    await invite(ann);
    expect(
      (await as(t, ann, `/v1/family/members/${cat.userId}`, { method: 'DELETE' })).status,
    ).toBe(204);
    expect(
      (await as(t, dan, '/v1/family', { method: 'DELETE', body: { confirmName: 'Home' } })).status,
    ).toBe(404);

    const mismatch = await as(t, ann, '/v1/family', {
      method: 'DELETE',
      body: { confirmName: 'home' },
    });
    expect(mismatch.status).toBe(400);
    expect(await errorCode(mismatch)).toBe('CONFIRMATION_MISMATCH');
    expect(
      (await as(t, ann, '/v1/family', { method: 'DELETE', body: { confirmName: 'Home' } })).status,
    ).toBe(204);

    const after = new Map(
      (await t.db.select().from(transactions)).map((tx) => [tx.id, tx] as const),
    );
    expect(after.has(orphan.id)).toBe(false);
    const [annGroceries] = await t.db
      .select()
      .from(categories)
      .where(
        and(eq(categories.workspaceId, annPersonal.id), eq(categories.systemKey, 'groceries')),
      );
    expect(after.get(annRow.id)).toMatchObject({
      workspaceId: annPersonal.id,
      accountId: null,
      categoryId: annGroceries!.id,
    });
    const [bobPets] = await t.db
      .select()
      .from(categories)
      .where(and(eq(categories.workspaceId, bobPersonal.id), eq(categories.name, 'Pets')));
    expect(bobPets).toMatchObject({ kind: 'expense', icon: 'dog' });
    expect(after.get(bobRow.id)).toMatchObject({
      workspaceId: bobPersonal.id,
      accountId: bobCard!.id,
      categoryId: bobPets!.id,
    });
    expect(after.get(bobGroceryRow.id)!.categoryId).toBe(bobGroceries!.id);
    const before = inserted.find((tx) => tx.id === annRow.id)!;
    expect(after.get(annRow.id)!.revision).toBeGreaterThan(before.revision);

    expect(await t.db.select().from(workspaces).where(eq(workspaces.id, family.id))).toEqual([]);
    expect(
      await t.db.select().from(categories).where(eq(categories.workspaceId, family.id)),
    ).toEqual([]);
    expect(await t.db.select().from(invitations)).toEqual([]);
    expect((await t.db.select().from(syncConflicts)).map((c) => c.id)).toEqual([annConflict!.id]);
    expect(after.get(annTombstone.id)).toMatchObject({
      workspaceId: annPersonal.id,
      categoryId: null,
    });
    expect(after.get(catRow.id)!.workspaceId).toBe((await personalOf(cat)).id);
    expect(
      await t.db
        .select()
        .from(categories)
        .where(and(eq(categories.workspaceId, annPersonal.id), eq(categories.name, 'Pets'))),
    ).toEqual([]);
    expect((await workspacesOf(bob)).map((w) => w.kind)).toEqual(['personal']);
  });
});
