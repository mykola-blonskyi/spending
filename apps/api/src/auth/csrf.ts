import { sameSecret } from './token-crypto';

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
  if (!sameSecret(input.sessionCsrfToken, input.headerToken)) return false;
  if (input.origin !== undefined) return input.origin === input.appOrigin;
  return input.secFetchSite === 'same-origin';
}
