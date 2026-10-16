import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { ApiError } from '../common/errors';
import { DB, type Db, type Tx } from '../database/database.module';
import { memberships, users, workspaces } from '../database/schema';
import { seedDefaultCategories } from '../workspaces/default-categories';
import type { Identity, Profile, ProfilePatch } from './profile';

export type Provisioned = Readonly<{
  userId: string;
  personalWorkspaceId: string;
}>;

export const profileColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  locale: users.locale,
  theme: users.theme,
  layout: users.layout,
  palette: users.palette,
  timezone: users.timezone,
};

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Upserts the user by `sub` and ensures their personal workspace. Preferences come from the
   * provider only on first login; later logins refresh identity fields only. The upsert's row
   * lock serializes concurrent first logins of one user, so the workspace is created once.
   * `tx` must come from `ledgerTransaction`, because a new workspace gets default categories.
   */
  async provision(tx: Tx, identity: Identity): Promise<Provisioned> {
    const [user] = await tx
      .insert(users)
      .values({
        oidcSub: identity.sub,
        email: identity.email,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        locale: identity.locale,
        theme: identity.theme,
        palette: identity.palette,
      })
      .onConflictDoUpdate({
        target: users.oidcSub,
        set: {
          email: identity.email,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: users.id });
    const userId = user!.id;
    const [existing] = await tx
      .select({ workspaceId: memberships.workspaceId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.workspaceKind, 'personal')));
    if (existing) {
      return { userId, personalWorkspaceId: existing.workspaceId };
    }
    const [workspace] = await tx
      .insert(workspaces)
      .values({ kind: 'personal', name: null, ownerId: userId })
      .returning({ id: workspaces.id });
    await tx.insert(memberships).values({
      workspaceId: workspace!.id,
      workspaceKind: 'personal',
      userId,
      role: 'owner',
    });
    await seedDefaultCategories(tx, workspace!.id);
    return { userId, personalWorkspaceId: workspace!.id };
  }

  async profile(userId: string): Promise<Profile> {
    const [row] = await this.db.select(profileColumns).from(users).where(eq(users.id, userId));
    if (!row) throw new ApiError('AUTH_REQUIRED');
    return row;
  }

  async updateProfile(userId: string, patch: ProfilePatch): Promise<Profile> {
    if (Object.keys(patch).length === 0) return this.profile(userId);
    const [row] = await this.db
      .update(users)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(eq(users.id, userId))
      .returning(profileColumns);
    if (!row) throw new ApiError('AUTH_REQUIRED');
    return row;
  }
}
