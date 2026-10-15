import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { ApiError } from '../common/errors';
import { DB, type Db, type Tx } from '../database/database.module';
import { memberships, workspaces } from '../database/schema';
import type { MemberRole, WorkspaceKind } from './family';

export type Membership = Readonly<{
  workspaceId: string;
  kind: WorkspaceKind;
  role: MemberRole;
  name: string;
}>;

const membershipColumns = {
  workspaceId: memberships.workspaceId,
  kind: memberships.workspaceKind,
  role: memberships.role,
  name: workspaces.name,
};

/**
 * The single authority on who may touch which workspace (BR-1, BR-2). A workspace the actor does
 * not belong to is reported as NOT_FOUND, so ids of other users' workspaces reveal nothing.
 */
@Injectable()
export class AccessPolicy {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Personal first, then the family, if any. */
  memberships(actorId: string, tx: Tx = this.db): Promise<Membership[]> {
    return tx
      .select(membershipColumns)
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(eq(memberships.userId, actorId))
      .orderBy(asc(memberships.workspaceKind));
  }

  async requireMember(actorId: string, workspaceId: string, tx: Tx = this.db): Promise<Membership> {
    const [row] = await tx
      .select(membershipColumns)
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(and(eq(memberships.userId, actorId), eq(memberships.workspaceId, workspaceId)));
    if (!row) throw new ApiError('NOT_FOUND');
    return row;
  }

  /** The one named workspace (NOT_FOUND unless a member), or every workspace of the actor. */
  async scope(actorId: string, workspaceId: string | undefined): Promise<Membership[]> {
    return workspaceId
      ? [await this.requireMember(actorId, workspaceId)]
      : await this.memberships(actorId);
  }

  async personalWorkspaceId(actorId: string, tx: Tx = this.db): Promise<string> {
    const [row] = await tx
      .select({ workspaceId: memberships.workspaceId })
      .from(memberships)
      .where(and(eq(memberships.userId, actorId), eq(memberships.workspaceKind, 'personal')));
    if (!row) throw new ApiError('AUTH_REQUIRED');
    return row.workspaceId;
  }

  async familyMembership(actorId: string, tx: Tx = this.db): Promise<Membership | null> {
    const [row] = await tx
      .select(membershipColumns)
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(and(eq(memberships.userId, actorId), eq(memberships.workspaceKind, 'family')));
    return row ?? null;
  }
}
