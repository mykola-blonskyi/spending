import { queryOptions } from '@tanstack/react-query';
import type { components } from './api.gen';
import { api } from './client';
import { present } from './session';

type Schemas = components['schemas'];
export type WorkspaceView = Schemas['WorkspaceDto_Output'];
export type FamilyMember = WorkspaceView['members'][number];
export type Invitation = Schemas['InvitationListDto_Output']['invitations'][number];
export type CreatedInvitation = Schemas['CreatedInvitationDto_Output'];
export type InvitationPreview = Schemas['InvitationPreviewDto_Output'];
export type FamilyEvent = Schemas['EventListDto_Output']['events'][number];

export const FAMILY_KEY = ['family'];

export const workspacesQuery = queryOptions({
  queryKey: [...FAMILY_KEY, 'workspaces'],
  queryFn: async ({ signal }) =>
    present((await api.GET('/api/v1/workspaces', { signal })).data).workspaces,
});

export const invitationsQuery = queryOptions({
  queryKey: [...FAMILY_KEY, 'invitations'],
  queryFn: async ({ signal }) =>
    present((await api.GET('/api/v1/family/invitations', { signal })).data).invitations,
});

export const eventsQuery = queryOptions({
  queryKey: [...FAMILY_KEY, 'events'],
  queryFn: async ({ signal }) =>
    present((await api.GET('/api/v1/family/events', { signal })).data).events,
});

export const invitationPreviewQuery = (token: string) =>
  queryOptions({
    queryKey: ['invitation', token],
    queryFn: async ({ signal }) =>
      present(
        (await api.GET('/api/v1/invitations/{token}', { params: { path: { token } }, signal }))
          .data,
      ),
    retry: false,
  });

export async function createFamily(name: string): Promise<WorkspaceView> {
  return present((await api.POST('/api/v1/family', { body: { name } })).data);
}

export async function createInvitation(expiresInDays: number): Promise<CreatedInvitation> {
  return present((await api.POST('/api/v1/family/invitations', { body: { expiresInDays } })).data);
}

export async function revokeInvitation(id: string): Promise<void> {
  await api.DELETE('/api/v1/family/invitations/{id}', { params: { path: { id } } });
}

export async function acceptInvitation(token: string): Promise<WorkspaceView> {
  return present(
    (await api.POST('/api/v1/invitations/{token}/accept', { params: { path: { token } } })).data,
  );
}

export async function leaveFamily(): Promise<void> {
  await api.POST('/api/v1/family/leave');
}

export async function removeMember(userId: string): Promise<void> {
  await api.DELETE('/api/v1/family/members/{userId}', { params: { path: { userId } } });
}

export async function transferOwnership(userId: string): Promise<WorkspaceView> {
  return present((await api.POST('/api/v1/family/transfer', { body: { userId } })).data);
}

export async function deleteFamily(confirmName: string): Promise<void> {
  await api.DELETE('/api/v1/family', { body: { confirmName } });
}
