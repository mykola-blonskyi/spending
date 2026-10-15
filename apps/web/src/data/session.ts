import { queryOptions } from '@tanstack/react-query';
import type { components } from './api.gen';
import { ApiError } from './api-error';
import { AUTH_LOST_CODES, type AuthLostCode } from './auth-events';
import { api } from './client';
import { setCsrfToken } from './csrf';

export type Profile = components['schemas']['ProfileDto_Output'];
export type ProfilePatch = components['schemas']['UpdateProfileDto'];
export type Session = components['schemas']['SessionDto_Output'];

export function present<T>(data: T | undefined): T {
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

const LAST_USER_KEY = 'spending.lastUser';

function rememberUser(user: Session['user']): void {
  try {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
  } catch {
    // Without storage the app needs the network to start.
  }
}

/** Forgets who last signed in on this device, so an offline start shows sign-in instead. */
export function forgetLastUser(): void {
  try {
    localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // Nothing was stored either.
  }
}

function lastUser(): Session['user'] | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LAST_USER_KEY) ?? 'null');
    if (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      'email' in value &&
      'displayName' in value &&
      typeof value.id === 'string' &&
      typeof value.email === 'string' &&
      typeof value.displayName === 'string'
    ) {
      return value as Session['user'];
    }
  } catch {
    // Unreadable: treat as nobody.
  }
  return null;
}

/**
 * Resolves to null when there is no session, so "signed out" is data rather than an error.
 * Offline, the user who last signed in on this device keeps working from their local data; the
 * CSRF token is fetched before the first write (`client.ts`).
 */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  networkMode: 'always',
  queryFn: async ({ signal }): Promise<Session | null> => {
    try {
      const { data } = await api.GET('/api/v1/auth/session', { signal });
      const session = present(data);
      setCsrfToken(session.csrfToken);
      rememberUser(session.user);
      return session;
    } catch (error) {
      if (isSignedOutError(error)) {
        forgetLastUser();
        return null;
      }
      const user = error instanceof ApiError && error.code === 'NETWORK' ? lastUser() : null;
      if (user) return { user, csrfToken: '' };
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
