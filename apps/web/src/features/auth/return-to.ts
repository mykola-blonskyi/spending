import type { AuthLostCode } from '@data/auth-events';

export const SIGN_IN_PATH = '/signin';

/**
 * Only same-origin paths survive; anything else could turn sign-in into an open redirect.
 * The sign-in page itself is refused too, since returning there after sign-in would loop.
 */
export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  const { pathname } = new URL(value, 'http://app.invalid');
  return pathname === SIGN_IN_PATH ? '/' : value;
}

export function loginHref(returnTo: string): string {
  return `/api/v1/auth/login?${new URLSearchParams({ returnTo })}`;
}

export function signInPath(returnTo: string, reason?: AuthLostCode): string {
  const params = new URLSearchParams();
  const target = safeReturnTo(returnTo);
  if (target !== '/') params.set('returnTo', target);
  if (reason) params.set('reason', reason);
  const query = params.toString();
  return query ? `${SIGN_IN_PATH}?${query}` : SIGN_IN_PATH;
}
