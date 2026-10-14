import type { CookieOptions, Request, Response } from 'express';

/** `__Host-` requires Secure, so an insecure local setup falls back to an unprefixed name. */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-spending_session' : 'spending_session';
}

/** Binds a login attempt to the browser that started it; lives only for the login round trip. */
export function loginCookieName(secure: boolean): string {
  return secure ? '__Host-spending_login' : 'spending_login';
}

export function setLoginCookie(res: Response, secure: boolean, value: string, ttlMs: number): void {
  res.cookie(loginCookieName(secure), value, { ...baseOptions(secure), maxAge: ttlMs });
}

export function clearLoginCookie(res: Response, secure: boolean): void {
  res.clearCookie(loginCookieName(secure), baseOptions(secure));
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

const baseOptions = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  secure,
  sameSite: 'lax',
  path: '/',
});

export function setSessionCookie(
  res: Response,
  secure: boolean,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(sessionCookieName(secure), token, {
    ...baseOptions(secure),
    maxAge: Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000) * 1000),
  });
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(sessionCookieName(secure), baseOptions(secure));
}
