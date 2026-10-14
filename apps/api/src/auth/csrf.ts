import { timingSafeEqual } from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type CsrfInput = Readonly<{
  method: string;
  appOrigin: string;
  sessionCsrfToken: string | undefined;
  headerToken: string | undefined;
  origin: string | undefined;
  secFetchSite: string | undefined;
}>;

/** Synchronizer token plus a same-origin proof (ADR-003). */
export function isCsrfSafe(input: CsrfInput): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true;
  if (!input.sessionCsrfToken || !input.headerToken) return false;
  const expected = Buffer.from(input.sessionCsrfToken);
  const given = Buffer.from(input.headerToken);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  if (input.origin !== undefined) return input.origin === input.appOrigin;
  return input.secFetchSite === 'same-origin';
}
