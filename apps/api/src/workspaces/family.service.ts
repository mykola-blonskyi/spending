import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { hashToken, randomToken } from '../auth/token-crypto';
import { APP_CONFIG, type AppConfig } from '../common/config';
import { ApiError } from '../common/errors';
import {
  DB,
  type Db,
  isUniqueViolation,
  ledgerTransaction,
  type Tx,
} from '../database/database.module';
import { invitations, memberships, users, workspaceEvents, workspaces } from '../database/schema';
import { AccessPolicy, type Membership } from './access-policy';
import { seedDefaultCategories } from './default-categories';
import { invitationState, type WorkspaceEventType, type WorkspaceView } from './family';

const DAY_MS = 86_400_000;
const EVENT_PAGE = 50;
const TOKEN_FORMAT = /^[\w-]{43}$/;

type PersonRef = { userId: string; displayName: string } | null;
const personRef = (userId: string | null, displayName: string | null): PersonRef =>
  userId && displayName !== null ? { userId, displayName } : null;

@Injectable()
export class FamilyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AccessPolicy) private readonly policy: AccessPolicy,
  ) {}

  async workspaces(actorId: string): Promise<WorkspaceView[]> {
    return this.views(this.db, await this.policy.memberships(actorId));
  }

  async create(actorId: string, name: string): Promise<WorkspaceView> {
    if (await this.policy.familyMembership(actorId)) throw new ApiError('FAMILY_EXISTS');
    try {
      return await ledgerTransaction(this.db, async (tx) => {
        const [workspace] = await tx
          .insert(workspaces)
          .values({ kind: 'family', name, ownerId: actorId })
          .returning({ id: workspaces.id });
        const workspaceId = workspace!.id;
        await tx
          .insert(memberships)
          .values({ workspaceId, workspaceKind: 'family', userId: actorId, role: 'owner' });
        await seedDefaultCategories(tx, workspaceId);
        await this.record(tx, workspaceId, actorId, 'family_created');
        return this.view(tx, { workspaceId, kind: 'family', role: 'owner', name });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'memberships_one_family_uq'))
        throw new ApiError('FAMILY_EXISTS');
      throw error;
    }
  }

  rename(actorId: string, name: string): Promise<WorkspaceView> {
    return this.db.transaction(async (tx) => {
      const family = await this.lockOwnedFamily(tx, actorId);
      if (family.name !== name) {
        await tx
          .update(workspaces)
          .set({ name, updatedAt: sql`now()` })
          .where(eq(workspaces.id, family.workspaceId));
        await this.record(tx, family.workspaceId, actorId, 'renamed');
      }
      return this.view(tx, { ...family, name });
    });
  }

  /**
   * BR-11. Transactions leave the family before the workspace is deleted, because deleting it
   * cascades to everything it still holds: accounts, categories, budgets, rules, invitations.
   */
  async delete(actorId: string, confirmName: string): Promise<void> {
    await ledgerTransaction(this.db, async (tx) => {
      const family = await this.lockOwnedFamily(tx, actorId);
      if (confirmName !== family.name) throw new ApiError('CONFIRMATION_MISMATCH');
      const familyId = family.workspaceId;
      await tx.execute(sql`
        delete from transactions where workspace_id = ${familyId} and created_by is null`);
      await tx.execute(sql`
        delete from sync_conflicts c using transactions t
        where c.transaction_id = t.id and t.workspace_id = ${familyId}
          and c.user_id <> t.created_by`);
      await tx.execute(sql`
        insert into categories (workspace_id, name, kind, color, icon, system_key)
        select distinct on (p.workspace_id, c.kind, c.name)
               p.workspace_id, c.name, c.kind, c.color, c.icon,
               case when exists (
                 select 1 from categories k
                 where k.workspace_id = p.workspace_id and k.system_key = c.system_key)
               then null else c.system_key end
        from transactions t
        join categories c on c.id = t.category_id
        join memberships p on p.user_id = t.created_by and p.workspace_kind = 'personal'
        where t.workspace_id = ${familyId} and t.deleted_at is null
        on conflict (workspace_id, kind, name) do nothing`);
      await tx.execute(sql`
        update transactions t set
          workspace_id = p.workspace_id,
          category_id = (
            select pc.id from categories fc
            join categories pc
              on pc.workspace_id = p.workspace_id and pc.kind = fc.kind and pc.name = fc.name
            where fc.id = t.category_id),
          account_id = case
            when t.account_id in (select id from accounts where workspace_id = ${familyId})
            then null else t.account_id end
        from memberships p
        where t.workspace_id = ${familyId}
          and p.user_id = t.created_by and p.workspace_kind = 'personal'`);
      await tx.delete(workspaces).where(eq(workspaces.id, familyId));
    });
  }

  async createInvitation(
    actorId: string,
    expiresInDays: number,
  ): Promise<{ id: string; url: string; expiresAt: string }> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + expiresInDays * DAY_MS);
    return this.db.transaction(async (tx) => {
      const family = await this.lockOwnedFamily(tx, actorId);
      const [row] = await tx
        .insert(invitations)
        .values({
          workspaceId: family.workspaceId,
          tokenHash: hashToken(token),
          createdBy: actorId,
          expiresAt,
        })
        .returning({ id: invitations.id });
      await this.record(tx, family.workspaceId, actorId, 'invitation_created');
      return {
        id: row!.id,
        url: `${this.config.appOrigin}/invite/${token}`,
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  async listInvitations(actorId: string) {
    const family = await this.policy.familyMembership(actorId);
    if (!family) throw new ApiError('NOT_FOUND');
    if (family.role !== 'owner') throw new ApiError('FORBIDDEN');
    const rows = await this.db
      .select({
        id: invitations.id,
        createdAt: invitations.createdAt,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        revokedAt: invitations.revokedAt,
        acceptedById: invitations.acceptedBy,
        acceptedByName: users.displayName,
      })
      .from(invitations)
      .leftJoin(users, eq(users.id, invitations.acceptedBy))
      .where(eq(invitations.workspaceId, family.workspaceId))
      .orderBy(desc(invitations.createdAt));
    const now = new Date();
    return rows.map((row) => ({
      id: row.id,
      state: invitationState(row, now),
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      acceptedBy: personRef(row.acceptedById, row.acceptedByName),
    }));
  }

  /** Idempotent: revoking a revoked or accepted invitation changes nothing. */
  async revokeInvitation(actorId: string, invitationId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const family = await this.lockOwnedFamily(tx, actorId);
      const [existing] = await tx
        .select({ id: invitations.id })
        .from(invitations)
        .where(
          and(eq(invitations.id, invitationId), eq(invitations.workspaceId, family.workspaceId)),
        );
      if (!existing) throw new ApiError('NOT_FOUND');
      const revoked = await tx
        .update(invitations)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(invitations.id, invitationId),
            sql`${invitations.revokedAt} is null and ${invitations.acceptedAt} is null`,
          ),
        )
        .returning({ id: invitations.id });
      if (revoked.length > 0) {
        await this.record(tx, family.workspaceId, actorId, 'invitation_revoked');
      }
    });
  }

  /**
   * Only a pending link reveals who invited; every other state answers like accept does, so a
   * leaked used or revoked link discloses nothing and the endpoint is no state oracle.
   */
  async previewInvitation(token: string) {
    if (!TOKEN_FORMAT.test(token)) throw new ApiError('INVITATION_INVALID');
    const owner = alias(users, 'owner');
    const [row] = await this.db
      .select({
        familyName: workspaces.name,
        ownerName: owner.displayName,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        revokedAt: invitations.revokedAt,
      })
      .from(invitations)
      .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
      .innerJoin(owner, eq(owner.id, workspaces.ownerId))
      .where(eq(invitations.tokenHash, hashToken(token)));
    if (!row || invitationState(row, new Date()) !== 'pending') {
      throw new ApiError('INVITATION_INVALID');
    }
    return {
      familyName: row.familyName,
      ownerName: row.ownerName,
      expiresAt: row.expiresAt.toISOString(),
      state: 'pending' as const,
    };
  }

  /**
   * BR-8. The conditional update consumes the invitation exactly once. Every reason it can fail
   * (unknown, used, revoked, expired) yields the same code, so the endpoint is no oracle. An actor
   * who already has a family is refused before the update, and a concurrent second family join
   * hits the unique index and rolls the consumption back. The workspace is key-share locked
   * before the invitation row, the same order a concurrent family deletion takes them in.
   */
  async acceptInvitation(actorId: string, token: string): Promise<WorkspaceView> {
    try {
      return await this.db.transaction(async (tx) => {
        if (await this.policy.familyMembership(actorId, tx)) throw new ApiError('FAMILY_EXISTS');
        if (!TOKEN_FORMAT.test(token)) throw new ApiError('INVITATION_INVALID');
        const tokenHash = hashToken(token);
        await tx.execute(sql`
          select 1 from workspaces w join invitations i on i.workspace_id = w.id
          where i.token_hash = ${tokenHash} for key share of w`);
        const [consumed] = await tx
          .update(invitations)
          .set({ acceptedAt: sql`now()`, acceptedBy: actorId })
          .where(
            and(
              eq(invitations.tokenHash, tokenHash),
              sql`${invitations.acceptedAt} is null and ${invitations.revokedAt} is null
                  and ${invitations.expiresAt} > now()`,
            ),
          )
          .returning({ workspaceId: invitations.workspaceId });
        if (!consumed) throw new ApiError('INVITATION_INVALID');
        const workspaceId = consumed.workspaceId;
        await tx
          .insert(memberships)
          .values({ workspaceId, workspaceKind: 'family', userId: actorId, role: 'member' });
        await this.record(tx, workspaceId, actorId, 'member_joined', actorId);
        return this.view(tx, await this.policy.requireMember(actorId, workspaceId, tx));
      });
    } catch (error) {
      if (isUniqueViolation(error, 'memberships_one_family_uq'))
        throw new ApiError('FAMILY_EXISTS');
      throw error;
    }
  }

  /** BR-9, BR-10. Authored family transactions stay in the family. */
  async leave(actorId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const family = await this.lockFamily(tx, actorId);
      if (family.role === 'owner') throw new ApiError('OWNER_CANNOT_LEAVE');
      await this.dropMember(tx, family.workspaceId, actorId);
      await this.record(tx, family.workspaceId, actorId, 'member_left', actorId);
    });
  }

  async removeMember(actorId: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const family = await this.lockOwnedFamily(tx, actorId);
      if (userId === actorId) throw new ApiError('OWNER_CANNOT_LEAVE');
      if (!(await this.dropMember(tx, family.workspaceId, userId))) {
        throw new ApiError('NOT_FOUND');
      }
      await this.record(tx, family.workspaceId, actorId, 'member_removed', userId);
    });
  }

  transfer(actorId: string, userId: string): Promise<WorkspaceView> {
    return this.db.transaction(async (tx) => {
      const family = await this.lockOwnedFamily(tx, actorId);
      if (userId === actorId) return this.view(tx, family);
      const promoted = await tx
        .update(memberships)
        .set({ role: 'owner' })
        .where(and(eq(memberships.workspaceId, family.workspaceId), eq(memberships.userId, userId)))
        .returning({ userId: memberships.userId });
      if (promoted.length === 0) throw new ApiError('NOT_FOUND');
      await tx
        .update(memberships)
        .set({ role: 'member' })
        .where(
          and(eq(memberships.workspaceId, family.workspaceId), eq(memberships.userId, actorId)),
        );
      await tx
        .update(workspaces)
        .set({ ownerId: userId, updatedAt: sql`now()` })
        .where(eq(workspaces.id, family.workspaceId));
      await this.record(tx, family.workspaceId, actorId, 'ownership_transferred', userId);
      return this.view(tx, { ...family, role: 'member' });
    });
  }

  async events(actorId: string) {
    const family = await this.policy.familyMembership(actorId);
    if (!family) throw new ApiError('NOT_FOUND');
    const actor = alias(users, 'actor');
    const subject = alias(users, 'subject');
    const rows = await this.db
      .select({
        id: workspaceEvents.id,
        type: workspaceEvents.type,
        actorId: actor.id,
        actorName: actor.displayName,
        subjectId: subject.id,
        subjectName: subject.displayName,
        createdAt: workspaceEvents.createdAt,
      })
      .from(workspaceEvents)
      .leftJoin(actor, eq(actor.id, workspaceEvents.actorId))
      .leftJoin(subject, eq(subject.id, workspaceEvents.subjectUserId))
      .where(eq(workspaceEvents.workspaceId, family.workspaceId))
      .orderBy(desc(workspaceEvents.createdAt), desc(workspaceEvents.id))
      .limit(EVENT_PAGE);
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      actor: personRef(row.actorId, row.actorName),
      subject: personRef(row.subjectId, row.subjectName),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Locks the actor's family row, serializing membership changes of one family. The membership
   * is read again under the lock because a concurrent change may have just committed. `no key
   * update` leaves foreign-key checks (ledger writers, joins) unblocked.
   */
  private async lockFamily(tx: Tx, actorId: string): Promise<Membership> {
    const before = await this.policy.familyMembership(actorId, tx);
    if (!before) throw new ApiError('NOT_FOUND');
    await tx.execute(
      sql`select 1 from workspaces where id = ${before.workspaceId} for no key update`,
    );
    const family = await this.policy.familyMembership(actorId, tx);
    if (family?.workspaceId !== before.workspaceId) throw new ApiError('NOT_FOUND');
    return family;
  }

  private async lockOwnedFamily(tx: Tx, actorId: string): Promise<Membership> {
    const family = await this.lockFamily(tx, actorId);
    if (family.role !== 'owner') throw new ApiError('FORBIDDEN');
    return family;
  }

  /** A former member keeps no open conflicts on family rows they can no longer see. */
  private async dropMember(tx: Tx, workspaceId: string, userId: string): Promise<boolean> {
    const removed = await tx
      .delete(memberships)
      .where(
        and(
          eq(memberships.workspaceId, workspaceId),
          eq(memberships.userId, userId),
          eq(memberships.role, 'member'),
        ),
      )
      .returning({ userId: memberships.userId });
    if (removed.length === 0) return false;
    await tx.execute(sql`
      delete from sync_conflicts c using transactions t
      where c.transaction_id = t.id and t.workspace_id = ${workspaceId} and c.user_id = ${userId}`);
    return true;
  }

  private async record(
    tx: Tx,
    workspaceId: string,
    actorId: string,
    type: WorkspaceEventType,
    subjectUserId: string | null = null,
  ): Promise<void> {
    await tx.insert(workspaceEvents).values({ workspaceId, actorId, type, subjectUserId });
  }

  private async view(tx: Tx, membership: Membership): Promise<WorkspaceView> {
    const [view] = await this.views(tx, [membership]);
    return view!;
  }

  private async views(tx: Tx, list: readonly Membership[]): Promise<WorkspaceView[]> {
    if (list.length === 0) return [];
    const members = await tx
      .select({
        workspaceId: memberships.workspaceId,
        userId: memberships.userId,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: memberships.role,
        joinedAt: memberships.joinedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        inArray(
          memberships.workspaceId,
          list.map((m) => m.workspaceId),
        ),
      )
      .orderBy(memberships.joinedAt, memberships.userId);
    return list.map((m) => ({
      id: m.workspaceId,
      kind: m.kind,
      name: m.name,
      role: m.role,
      members: members
        .filter((row) => row.workspaceId === m.workspaceId)
        .map(({ workspaceId: _workspaceId, joinedAt, ...row }) => ({
          ...row,
          joinedAt: joinedAt.toISOString(),
        })),
    }));
  }
}
