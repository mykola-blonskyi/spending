/**
 * Accepts only same-origin absolute paths, so the post-login redirect can never leave the app.
 * Anything else falls back to '/'.
 */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  // Browsers strip tabs and newlines from URLs, which would turn "/\t/evil" into "//evil".
  if ([...value].some((c) => c <= '\u001f' || c === '\u007f' || c === '\\')) return '/';
  const parsed = new URL(value, 'http://app.invalid');
  if (parsed.origin !== 'http://app.invalid') return '/';
  const target = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  // Dot segments collapse during parsing ("/..//evil" becomes "//evil"), so check the result too.
  if (target.startsWith('//') || target.startsWith('/\\')) return '/';
  // The web app carries the invitation token itself; it is never stored in a login attempt (BR-8).
  return parsed.pathname.startsWith('/invite/') ? '/invite' : target;
}
