import { queryOptions } from '@tanstack/react-query';
import type { components } from './api.gen';
import { ApiError } from './api-error';
import { AUTH_LOST_CODES, type AuthLostCode } from './auth-events';
import { api } from './client';
import { setCsrfToken } from './csrf';

export type Profile = components['schemas']['ProfileDto_Output'];
export type ProfilePatch = components['schemas']['UpdateProfileDto'];
export type Session = components['schemas']['SessionDto_Output'];

function present<T>(data: T | undefined): T {
  if (data === undefined) {
    throw new ApiError({ status: 0, code: 'INTERNAL', message: 'Empty response' });
  }
  return data;
}

export function isSignedOutError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    AUTH_LOST_CODES.includes(error.code as AuthLostCode)
  );
}

/** Resolves to null when there is no session, so "signed out" is data rather than an error. */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async ({ signal }): Promise<Session | null> => {
    try {
      const { data } = await api.GET('/api/v1/auth/session', { signal });
      const session = present(data);
      setCsrfToken(session.csrfToken);
      return session;
    } catch (error) {
      if (isSignedOutError(error)) return null;
      throw error;
    }
  },
});

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async ({ signal }) => present((await api.GET('/api/v1/me', { signal })).data),
});

export async function updateMe(patch: ProfilePatch): Promise<Profile> {
  return present((await api.PATCH('/api/v1/me', { body: patch })).data);
}

export async function logout(): Promise<{ endSessionUrl: string | null }> {
  return present((await api.POST('/api/v1/auth/logout')).data);
}
