import type { AuthLostCode } from '@data/auth-events';

export const SIGN_IN_PATH = '/signin';

/**
 * Only same-origin paths survive; anything else could turn sign-in into an open redirect. This
 * mirrors the API's sanitizer: browsers strip tabs and newlines and treat backslashes as slashes,
 * and dot segments collapse during parsing ("/..//evil" becomes "//evil"), so the parsed result
 * is checked too. The sign-in page itself is refused, since returning there would loop.
 */
export function safeReturnTo(value: string | null): string {
  if (!value || value.length > 2048 || !value.startsWith('/')) return '/';
  if ([...value].some((c) => c <= '\u001f' || c === '\u007f' || c === '\\')) return '/';
  const parsed = new URL(value, 'http://app.invalid');
  if (parsed.origin !== 'http://app.invalid') return '/';
  const target = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (target.startsWith('//') || parsed.pathname === SIGN_IN_PATH) return '/';
  return target;
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
