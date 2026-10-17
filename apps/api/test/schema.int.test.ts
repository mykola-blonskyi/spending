import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  budgets,
  categories,
  invitations,
  memberships,
  recurringRules,
  syncConflicts,
  transactions,
  users,
  workspaces,
} from '../src/database/schema';
import { ledgerTransaction } from '../src/database/database.module';
import { resetData, startTestApp, type TestApp } from './harness';

describe('schema invariants', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });
  beforeEach(() => resetData(t.db));
  afterAll(() => t.app.close());

  async function userWithWorkspace(sub: string) {
    const [user] = await t.db
      .insert(users)
      .values({ oidcSub: sub, email: `${sub}@example.test`, displayName: sub })
      .returning();
    const [workspace] = await t.db
      .insert(workspaces)
      .values({ kind: 'personal', name: 'Personal', ownerId: user!.id })
      .returning();
    await t.db.insert(memberships).values({
      workspaceId: workspace!.id,
      workspaceKind: 'personal',
      userId: user!.id,
      role: 'owner',
    });
    return { user: user!, workspace: workspace! };
  }

  const baseTx = (workspaceId: string) => ({
    id: crypto.randomUUID(),
    workspaceId,
    kind: 'expense' as const,
    amountMinor: 1250,
    currency: 'EUR',
    baseAmountMinor: 1250,
    occurredOn: '2026-10-01',
  });

  it('assigns increasing global revisions across writes', async () => {
    const { workspace } = await userWithWorkspace('a');
    const [first] = await t.db.insert(transactions).values(baseTx(workspace.id)).returning();
    const [second] = await t.db.insert(transactions).values(baseTx(workspace.id)).returning();
    expect(second!.revision).toBeGreaterThan(first!.revision);
    const [updated] = await t.db
      .update(transactions)
      .set({ description: 'Coffee' })
      .where(eq(transactions.id, first!.id))
      .returning();
    expect(updated!.revision).toBeGreaterThan(second!.revision);
    expect(updated!.version).toBe(2);
  });

  it('keeps the version when only derived conversion fields change', async () => {
    const { workspace } = await userWithWorkspace('rev2');
    const [row] = await t.db
      .insert(transactions)
      .values({ ...baseTx(workspace.id), currency: 'USD', baseAmountMinor: null })
      .returning();
    const [filled] = await t.db
      .update(transactions)
      .set({ baseAmountMinor: 1155, fxRate: '1.0823', fxRateDate: '2026-10-01', fxSource: 'ecb' })
      .where(eq(transactions.id, row!.id))
      .returning();
    expect(filled!.version).toBe(1);
    expect(filled!.revision).toBeGreaterThan(row!.revision);
  });

  it('assigns revisions in commit order across concurrent writers', async () => {
    const { workspace } = await userWithWorkspace('rev3');
    let releaseFirst!: () => void;
    const firstHolds = new Promise<void>((resolve) => (releaseFirst = resolve));
    const first = t.db.transaction(async (tx) => {
      const [row] = await tx.insert(transactions).values(baseTx(workspace.id)).returning();
      await firstHolds;
      return row!;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    let secondCommitted = false;
    const second = t.db
      .insert(transactions)
      .values(baseTx(workspace.id))
      .returning()
      .then((rows) => ((secondCommitted = true), rows));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const committedEarly = secondCommitted;
    releaseFirst();
    expect(committedEarly, 'a later writer must wait for the open writer to commit').toBe(false);
    const [a, [b]] = await Promise.all([first, second]);
    expect(b!.revision).toBeGreaterThan(a.revision);
  });

  it('lets ledger writers touch rows in opposite order without deadlocking', async () => {
    const { workspace } = await userWithWorkspace('dl');
    const [a] = await t.db.insert(transactions).values(baseTx(workspace.id)).returning();
    const [b] = await t.db.insert(transactions).values(baseTx(workspace.id)).returning();
    const touch = (first: string, second: string) =>
      ledgerTransaction(t.db, async (tx) => {
        await tx.update(transactions).set({ note: first }).where(eq(transactions.id, first));
        await new Promise((resolve) => setTimeout(resolve, 50));
        await tx.update(transactions).set({ note: second }).where(eq(transactions.id, second));
      });
    await Promise.all([touch(a!.id, b!.id), touch(b!.id, a!.id)]);
  });

  it('keeps EUR base amounts equal to the amount', async () => {
    const { workspace } = await userWithWorkspace('eur');
    await expect(
      t.db.insert(transactions).values({ ...baseTx(workspace.id), baseAmountMinor: 999 }),
    ).rejects.toThrow();
  });

  it('rejects non-positive amounts and malformed currencies', async () => {
    const { workspace } = await userWithWorkspace('b');
    await expect(
      t.db.insert(transactions).values({ ...baseTx(workspace.id), amountMinor: 0 }),
    ).rejects.toThrow();
    await expect(
      t.db.insert(transactions).values({ ...baseTx(workspace.id), currency: 'eur' }),
    ).rejects.toThrow();
  });

  it('enforces the documented invariants the services already check', async () => {
    const { user, workspace } = await userWithWorkspace('ck');
    const violated = (write: PromiseLike<unknown>) =>
      Promise.resolve(write).then(
        () => 'none',
        (error: Error) => (error.cause as { constraint?: string }).constraint,
      );
    const tooBig = 1_000_000_000_001;
    expect(
      await violated(
        t.db
          .insert(transactions)
          .values({ ...baseTx(workspace.id), amountMinor: tooBig, baseAmountMinor: tooBig }),
      ),
    ).toBe('transactions_amount_ck');
    const [category] = await t.db
      .insert(categories)
      .values({ workspaceId: workspace.id, name: 'Food', kind: 'expense', color: 'c', icon: 'i' })
      .returning();
    expect(
      await violated(
        t.db
          .insert(budgets)
          .values({ workspaceId: workspace.id, categoryId: category!.id, amountMinor: tooBig }),
      ),
    ).toBe('budgets_amount_ck');
    const rule = {
      workspaceId: workspace.id,
      kind: 'expense' as const,
      amountMinor: 100,
      currency: 'EUR',
      frequency: 'monthly' as const,
      startsOn: '2026-10-01',
      timezone: 'Europe/Berlin',
    };
    expect(
      await violated(t.db.insert(recurringRules).values({ ...rule, amountMinor: tooBig })),
    ).toBe('recurring_amount_ck');
    expect(
      await violated(t.db.insert(recurringRules).values({ ...rule, endsOn: '2026-09-30' })),
    ).toBe('recurring_ends_after_start_ck');
    expect(
      await violated(
        t.db.insert(invitations).values({
          workspaceId: workspace.id,
          tokenHash: 'h',
          expiresAt: new Date(),
          acceptedAt: new Date(),
          revokedAt: new Date(),
        }),
      ),
    ).toBe('invitations_settled_once_ck');
    const [row] = await t.db.insert(transactions).values(baseTx(workspace.id)).returning();
    expect(
      await violated(
        t.db.insert(syncConflicts).values({
          transactionId: row!.id,
          userId: user.id,
          baseVersion: 1,
          serverVersion: 1,
          local: {},
          status: 'resolved',
        }),
      ),
    ).toBe('sync_conflicts_resolution_ck');
    expect(
      await violated(
        t.db.insert(categories).values({
          workspaceId: workspace.id,
          name: null,
          kind: 'expense',
          color: 'c',
          icon: 'i',
        }),
      ),
    ).toBe('categories_named_or_default_ck');
    expect(
      await violated(t.db.insert(workspaces).values({ kind: 'family', ownerId: user.id })),
    ).toBe('workspaces_family_named_ck');
    expect(await violated(t.db.delete(users).where(eq(users.id, user.id)))).toBe(
      'workspaces_owner_id_users_id_fk',
    );
  });

  it('requires a conversion unless the rate is genuinely missing', async () => {
    const { workspace } = await userWithWorkspace('c');
    await expect(
      t.db.insert(transactions).values({ ...baseTx(workspace.id), baseAmountMinor: null }),
    ).rejects.toThrow();
    await t.db
      .insert(transactions)
      .values({ ...baseTx(workspace.id), currency: 'USD', baseAmountMinor: null });
  });

  it('allows one personal workspace and one family per user', async () => {
    const { user } = await userWithWorkspace('d');
    const [extra] = await t.db
      .insert(workspaces)
      .values({ kind: 'personal', name: 'Second', ownerId: user.id })
      .returning();
    await expect(
      t.db.insert(memberships).values({
        workspaceId: extra!.id,
        workspaceKind: 'personal',
        userId: user.id,
        role: 'owner',
      }),
    ).rejects.toThrow();
  });

  it('prevents a membership kind that disagrees with its workspace', async () => {
    const { user, workspace } = await userWithWorkspace('e');
    await expect(
      t.db.insert(memberships).values({
        workspaceId: workspace.id,
        workspaceKind: 'family',
        userId: user.id,
        role: 'member',
      }),
    ).rejects.toThrow();
  });
});
