import { z } from 'zod';

export const WORKSPACE_KINDS = ['personal', 'family'] as const;
export const MEMBER_ROLES = ['owner', 'member'] as const;
export const INVITATION_STATES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export const WORKSPACE_EVENT_TYPES = [
  'family_created',
  'renamed',
  'invitation_created',
  'invitation_revoked',
  'member_joined',
  'member_left',
  'member_removed',
  'ownership_transferred',
] as const;

export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type InvitationState = (typeof INVITATION_STATES)[number];
export type WorkspaceEventType = (typeof WORKSPACE_EVENT_TYPES)[number];

export const INVITATION_DEFAULT_DAYS = 7;

/** Null while a default category or the personal workspace goes by its key (ADR-012). */
export const storedName = z.string().nullable().meta({ id: 'StoredName' });

/** State is never stored; it follows from the timestamps (domain model, Invitation). */
export function invitationState(
  invitation: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date,
): InvitationState {
  if (invitation.acceptedAt) return 'accepted';
  if (invitation.revokedAt) return 'revoked';
  if (invitation.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

const familyName = z.string().trim().min(1).max(60);

export const familyNameBodySchema = z.strictObject({ name: familyName });
export const deleteFamilyBodySchema = z.strictObject({ confirmName: z.string().max(200) });
export const createInvitationBodySchema = z.strictObject({
  expiresInDays: z.int().min(1).max(30).default(INVITATION_DEFAULT_DAYS),
});
export const transferBodySchema = z.strictObject({ userId: z.uuid() });

const personRef = z.object({ userId: z.uuid(), displayName: z.string() });

export const memberViewSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(MEMBER_ROLES),
  joinedAt: z.iso.datetime(),
});

export const workspaceViewSchema = z.object({
  id: z.uuid(),
  kind: z.enum(WORKSPACE_KINDS),
  name: storedName,
  role: z.enum(MEMBER_ROLES),
  members: z.array(memberViewSchema),
});
export type WorkspaceView = z.infer<typeof workspaceViewSchema>;

export const workspaceListSchema = z.object({ workspaces: z.array(workspaceViewSchema) });

export const createdInvitationSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  expiresAt: z.iso.datetime(),
});

export const invitationListSchema = z.object({
  invitations: z.array(
    z.object({
      id: z.uuid(),
      state: z.enum(INVITATION_STATES),
      createdAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
      acceptedAt: z.iso.datetime().nullable(),
      revokedAt: z.iso.datetime().nullable(),
      acceptedBy: personRef.nullable(),
    }),
  ),
});

export const invitationPreviewSchema = z.object({
  familyName: z.string(),
  ownerName: z.string(),
  expiresAt: z.iso.datetime(),
  state: z.enum(INVITATION_STATES),
});

export const eventListSchema = z.object({
  events: z.array(
    z.object({
      id: z.uuid(),
      type: z.enum(WORKSPACE_EVENT_TYPES),
      actor: personRef.nullable(),
      subject: personRef.nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
});
