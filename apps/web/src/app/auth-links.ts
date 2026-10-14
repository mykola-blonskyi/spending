/** Only same-origin paths survive; anything else could turn sign-in into an open redirect. */
export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  return value;
}

export function loginHref(returnTo: string): string {
  return `/api/v1/auth/login?${new URLSearchParams({ returnTo })}`;
}
