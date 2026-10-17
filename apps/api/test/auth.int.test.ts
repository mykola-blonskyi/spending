import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../src/auth/token-crypto';
import { loginAttempts, memberships, sessions, users, workspaces } from '../src/database/schema';
import { type FakeOidc, startFakeOidc, type Tamper } from './fake-oidc/server';
import {
  api,
  as,
  callback,
  freshIp,
  login,
  loginAs,
  resetData,
  type Session,
  sessionCookieFrom,
  startTestApp,
  TEST_CLIENT,
  type TestApp,
} from './harness';

const ann = {
  sub: 'sub-ann',
  email: 'ann@example.test',
  name: 'Ann',
  picture: 'https://cdn.example.test/ann.png',
  locale: 'uk',
  theme: 'theme-rose',
};
const bob = { sub: 'sub-bob', email: 'bob@example.test', name: 'Bob' };

describe('authentication', () => {
  let provider: FakeOidc;
  let t: TestApp;

  beforeAll(async () => {
    provider = await startFakeOidc({ users: [ann, bob], clients: [TEST_CLIENT] });
    t = await startTestApp({ OIDC_ISSUER: provider.issuer });
  });
  beforeEach(async () => {
    await resetData(t.db);
    provider.setTamper(null);
    provider.setOutage(false);
    provider.restoreGrant(ann.sub);
    provider.setUser(ann);
  });
  afterAll(async () => {
    await t.app.close();
    await provider.close();
  });

  const signedIn = (sub = ann.sub) => loginAs(t, sub);

  const ageSession = (cookie: string, column: string, interval: string) =>
    t.db.execute(
      sql`update sessions set ${sql.raw(column)} = now() - ${interval}::interval
          where token_hash = ${hashToken(cookie)}`,
    );

  describe('login', () => {
    it('signs in, sets a hardened cookie and serves the session', async () => {
      const outcome = await login(t, ann.sub, { returnTo: '/history?month=2026-10' });
      expect(outcome.location).toBe('/history?month=2026-10');
      const setCookie = outcome.setCookie.find((line) =>
        line.startsWith('__Host-spending_session='),
      );
      expect(setCookie).toMatch(/; Max-Age=2592000;/);
      expect(setCookie).toMatch(/; Path=\//);
      expect(setCookie).toMatch(/; HttpOnly/);
      expect(setCookie).toMatch(/; Secure/);
      expect(setCookie).toMatch(/; SameSite=Lax/);

      const response = await api(t, '/v1/auth/session', { cookie: outcome.cookie });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await response.json();
      expect(body).toEqual({
        user: {
          id: expect.any(String),
          email: ann.email,
          displayName: 'Ann',
          avatarUrl: ann.picture,
          locale: 'uk',
          theme: 'system',
          layout: 'calm',
          palette: 'rose',
          timezone: 'Europe/Madrid',
        },
        csrfToken: expect.stringMatching(/^[\w-]{43}$/),
      });

      const [row] = await t.db.select().from(sessions);
      expect(row!.tokenHash).toBe(hashToken(outcome.cookie!));
      expect(row!.refreshTokenEnc).toMatch(/^[\w-]+$/);
      expect(row!.idTokenEnc).toMatch(/^[\w-]+$/);
      expect(await t.db.select().from(loginAttempts)).toHaveLength(0);
    });

    it('creates the personal workspace exactly once and refreshes identity only', async () => {
      const first = await signedIn();
      await api(t, '/v1/me', {
        method: 'PATCH',
        cookie: first.cookie,
        csrf: first.csrf,
        body: { theme: 'dark', locale: 'es', layout: 'split' },
      });
      provider.setUser({ ...ann, name: 'Ann Renamed', email: 'ann@new.test', locale: 'en' });
      await login(t, ann.sub);

      const owned = await t.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.ownerId, first.userId));
      expect(owned).toEqual([expect.objectContaining({ kind: 'personal', name: null })]);
      expect(await t.db.select().from(memberships)).toEqual([
        expect.objectContaining({ userId: first.userId, role: 'owner', workspaceKind: 'personal' }),
      ]);
      const [user] = await t.db.select().from(users);
      expect(user).toMatchObject({
        displayName: 'Ann Renamed',
        email: 'ann@new.test',
        locale: 'es',
        theme: 'dark',
        layout: 'split',
        palette: 'rose',
      });
    });

    it('provisions concurrent first logins of one user once', async () => {
      const outcomes = await Promise.all([login(t, bob.sub), login(t, bob.sub)]);
      expect(outcomes.map((o) => o.location)).toEqual(['/', '/']);
      expect(await t.db.select().from(workspaces)).toHaveLength(1);
      expect(await t.db.select().from(sessions)).toHaveLength(2);
    });

    it('replaces the session the browser already had', async () => {
      const first = await signedIn();
      const second = await login(t, ann.sub, { cookie: first.cookie });
      expect((await api(t, '/v1/me', { cookie: first.cookie })).status).toBe(401);
      expect((await api(t, '/v1/me', { cookie: second.cookie })).status).toBe(200);
    });

    it('rejects a replayed state', async () => {
      const first = await login(t, ann.sub);
      expect(first.cookie).toBeDefined();
      const replay = await callback(first.callbackUrl);
      expect(replay.location).toBe('/signin?error=login_failed');
      expect(replay.cookie).toBeUndefined();
    });

    it('rejects a callback replayed into a browser that did not start the login', async () => {
      const outcome = await login(t, ann.sub, { withoutBinding: true });
      expect(outcome.location).toBe('/signin?error=login_failed');
      expect(outcome.cookie).toBeUndefined();
    });

    it('rejects an expired login attempt', async () => {
      const outcome = await login(t, ann.sub, {
        beforeCallback: async () => {
          await t.db.update(loginAttempts).set({ expiresAt: new Date(Date.now() - 1000) });
        },
      });
      expect(outcome.location).toBe('/signin?error=login_expired');
      expect(outcome.cookie).toBeUndefined();
    });

    it.each<Tamper>(['wrongAudience', 'wrongIssuer', 'expired', 'badSignature', 'wrongNonce'])(
      'rejects an ID token with %s',
      async (tamper) => {
        provider.setTamper(tamper);
        const outcome = await login(t, ann.sub);
        expect(outcome.location).toBe('/signin?error=login_failed');
        expect(outcome.cookie).toBeUndefined();
        expect(await t.db.select().from(users)).toHaveLength(0);
        expect(await t.db.select().from(sessions)).toHaveLength(0);
      },
    );

    it('sends a login that fails after the exchange back to sign-in', async () => {
      await t.db.execute(sql`
        create function refuse_session() returns trigger language plpgsql
          as $$ begin raise exception 'refused'; end $$;
        create trigger refuse_session before insert on sessions
          for each row execute function refuse_session();`);
      try {
        const outcome = await login(t, ann.sub);
        expect(outcome.location).toBe('/signin?error=login_failed');
        expect(outcome.cookie).toBeUndefined();
      } finally {
        await t.db.execute(sql`drop function refuse_session() cascade`);
      }
    });

    it('rejects a callback with an unknown state or a provider error', async () => {
      const unknown = await callback(`${t.baseUrl}/api/v1/auth/callback?code=x&state=nope`);
      expect(unknown.location).toBe('/signin?error=login_failed');
      const missing = await callback(`${t.baseUrl}/api/v1/auth/callback?error=access_denied`);
      expect(missing.location).toBe('/signin?error=login_failed');
    });

    it.each([
      '//evil.example/',
      '/\\evil.example',
      'https://evil.example/',
      '/\t/evil.example',
      'javascript:alert(1)',
      '/..//evil.example/x',
      '/%2e%2e//evil.example/x',
    ])('neutralizes the open redirect %j', async (returnTo) => {
      const outcome = await login(t, ann.sub, { returnTo });
      expect(outcome.location).toBe('/');
    });

    it('rate-limits sign-in attempts per client IP', async () => {
      const ip = freshIp();
      const statuses: number[] = [];
      for (let i = 0; i < 21; i += 1) {
        const response = await fetch(`${t.baseUrl}/api/v1/auth/login`, {
          redirect: 'manual',
          headers: { 'x-forwarded-for': ip },
        });
        statuses.push(response.status);
        if (response.status === 429) {
          expect(await response.json()).toEqual({
            error: { code: 'RATE_LIMITED', message: 'RATE_LIMITED' },
          });
        }
      }
      expect(statuses.slice(0, 20).every((status) => status === 302)).toBe(true);
      expect(statuses[20]).toBe(429);
    });

    it('keys the sign-in limit on the hop nginx adds, not on addresses a client prepends', async () => {
      const ip = freshIp();
      const statuses: number[] = [];
      for (let i = 1; i <= 21; i += 1) {
        const response = await fetch(`${t.baseUrl}/api/v1/auth/login`, {
          redirect: 'manual',
          headers: { 'x-forwarded-for': `198.51.100.${i}, ${ip}` },
        });
        statuses.push(response.status);
      }
      expect(statuses[20]).toBe(429);
    });

    it('rate-limits each signed-in user on their own budget, whatever their IP', async () => {
      const [annSession, bobSession] = [await signedIn(ann.sub), await signedIn(bob.sub)];
      const invite = (session: Session) =>
        as(t, session, '/v1/family/invitations', { method: 'POST', body: {} });
      const statuses: number[] = [];
      for (let i = 0; i < 31; i += 1) statuses.push((await invite(annSession)).status);
      expect(statuses.slice(0, 30)).not.toContain(429);
      expect(statuses[30]).toBe(429);
      expect((await invite(bobSession)).status).not.toBe(429);
    });
  });

  describe('session', () => {
    it('requires a session', async () => {
      const response = await api(t, '/v1/me');
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: 'AUTH_REQUIRED', message: 'AUTH_REQUIRED' },
      });
      expect((await api(t, '/v1/auth/session', { cookie: 'forged' })).status).toBe(401);
    });

    it('expires an idle session and deletes it', async () => {
      const { cookie } = await signedIn();
      await ageSession(cookie, 'last_seen_at', '15 days');
      const response = await api(t, '/v1/me', { cookie });
      expect(response.status).toBe(401);
      expect(await t.db.select().from(sessions)).toHaveLength(0);
    });

    it('rotates after 24 hours and honours the old token only within the grace window', async () => {
      const { cookie, csrf } = await signedIn();
      await ageSession(cookie, 'rotated_at', '25 hours');

      const [a, b] = await Promise.all([
        api(t, '/v1/me', { cookie }),
        api(t, '/v1/me', { cookie }),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const issued = [sessionCookieFrom(a), sessionCookieFrom(b)].filter(Boolean);
      expect(issued).toHaveLength(1);
      const next = issued[0]!;
      expect(next).not.toBe(cookie);

      expect((await api(t, '/v1/me', { cookie })).status).toBe(200);
      const fresh = await api(t, '/v1/auth/session', { cookie: next });
      expect(fresh.status).toBe(200);
      expect(sessionCookieFrom(fresh)).toBeUndefined();
      expect(((await fresh.json()) as { csrfToken: string }).csrfToken).toBe(csrf);

      await ageSession(next, 'rotated_at', '61 seconds');
      const superseded = await api(t, '/v1/me', { cookie });
      expect(superseded.status).toBe(401);
      expect(sessionCookieFrom(superseded)).toBeUndefined();
      expect((await api(t, '/v1/me', { cookie: next })).status).toBe(200);
      expect(await t.db.select().from(sessions)).toHaveLength(1);
    });
  });

  describe('grant re-check', () => {
    it('revokes the session once the provider grant is gone', async () => {
      const { cookie } = await signedIn();
      provider.revokeGrant(ann.sub);
      expect((await api(t, '/v1/me', { cookie })).status).toBe(200);

      await ageSession(cookie, 'grant_checked_at', '6 minutes');
      const response = await api(t, '/v1/me', { cookie });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: 'SESSION_REVOKED', message: 'SESSION_REVOKED' },
      });
      expect(response.headers.getSetCookie().join()).toMatch(/__Host-spending_session=;/);
      expect(await t.db.select().from(sessions)).toHaveLength(0);
    });

    it('refreshes exactly once for concurrent requests and stores the rotated token', async () => {
      const { cookie } = await signedIn();
      const [before] = await t.db.select().from(sessions);
      await ageSession(cookie, 'grant_checked_at', '6 minutes');
      const calls = provider.refreshCalls;

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => api(t, '/v1/me', { cookie })),
      );
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(provider.refreshCalls - calls).toBe(1);

      const [after] = await t.db.select().from(sessions);
      expect(after!.refreshTokenEnc).not.toBe(before!.refreshTokenEnc);
      await ageSession(cookie, 'grant_checked_at', '6 minutes');
      expect((await api(t, '/v1/me', { cookie })).status).toBe(200);
      expect(provider.refreshCalls - calls).toBe(2);
    });

    it('keeps serving while the provider is unavailable', async () => {
      const { cookie } = await signedIn();
      await ageSession(cookie, 'grant_checked_at', '6 minutes');
      provider.setOutage(true);
      expect((await api(t, '/v1/me', { cookie })).status).toBe(200);
      expect(await t.db.select().from(sessions)).toHaveLength(1);
    });

    it('revokes a session that holds no refresh token', async () => {
      const { cookie } = await signedIn();
      await t.db.update(sessions).set({ refreshTokenEnc: null });
      await ageSession(cookie, 'grant_checked_at', '6 minutes');
      const response = await api(t, '/v1/me', { cookie });
      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'SESSION_REVOKED',
      );
    });
  });

  describe('CSRF', () => {
    const csrfFailed = { error: { code: 'CSRF_FAILED', message: 'CSRF_FAILED' } };

    it.each([
      [
        'a missing token',
        (_csrf: string) => ({
          csrf: undefined as string | undefined,
          origin: undefined,
        }),
      ],
      ['a wrong token', (csrf: string) => ({ csrf: `${csrf.slice(0, -1)}x`, origin: undefined })],
      ['a foreign origin', (csrf: string) => ({ csrf, origin: 'https://evil.example' })],
      ['no origin and no fetch metadata', (csrf: string) => ({ csrf, origin: null })],
    ] as const)('rejects %s', async (_name, build) => {
      const session = await signedIn();
      const response = await api(t, '/v1/me', {
        method: 'PATCH',
        cookie: session.cookie,
        body: { displayName: 'Mallory' },
        ...build(session.csrf),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(csrfFailed);
    });

    it('accepts the session token from the app origin or a same-origin fetch', async () => {
      const session = await signedIn();
      const patched = await api(t, '/v1/me', {
        method: 'PATCH',
        cookie: session.cookie,
        csrf: session.csrf,
        body: { displayName: '  Ann B  ', timezone: 'America/New_York' },
      });
      expect(patched.status).toBe(200);
      expect(await patched.json()).toMatchObject({
        displayName: 'Ann B',
        timezone: 'America/New_York',
      });
      const sameOrigin = await api(t, '/v1/me', {
        method: 'PATCH',
        cookie: session.cookie,
        csrf: session.csrf,
        origin: null,
        secFetchSite: 'same-origin',
        body: { theme: 'light' },
      });
      expect(sameOrigin.status).toBe(200);
    });
  });

  describe('profile', () => {
    it.each([
      { timezone: 'Mars/Olympus' },
      { displayName: '' },
      { displayName: 'x'.repeat(81) },
      { locale: 'de' },
      { theme: 'rose' },
      { layout: 'grid' },
      { id: '00000000-0000-0000-0000-000000000000' },
    ])('rejects %j', async (body) => {
      const session = await signedIn();
      const response = await api(t, '/v1/me', {
        method: 'PATCH',
        cookie: session.cookie,
        csrf: session.csrf,
        body,
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'VALIDATION_FAILED',
      );
    });
  });

  describe('logout', () => {
    it('destroys the session, revokes the refresh token and returns the end-session URL', async () => {
      const session = await signedIn();
      const revocations = provider.revocations;
      const response = await api(t, '/v1/auth/logout', {
        method: 'POST',
        cookie: session.cookie,
        csrf: session.csrf,
      });
      expect(response.status).toBe(200);
      const { endSessionUrl } = (await response.json()) as { endSessionUrl: string };
      const url = new URL(endSessionUrl);
      expect(`${url.origin}${url.pathname}`).toBe(`${provider.issuer}/logout`);
      expect(url.searchParams.get('id_token_hint')).toMatch(/^ey/);
      expect(url.searchParams.get('post_logout_redirect_uri')).toBe('http://app.test/signin');
      expect(response.headers.getSetCookie().join()).toMatch(/__Host-spending_session=;/);
      expect(provider.revocations - revocations).toBe(1);

      expect(await t.db.select().from(sessions)).toHaveLength(0);
      expect((await api(t, '/v1/me', { cookie: session.cookie })).status).toBe(401);
    });

    it('still logs out when the provider is unreachable', async () => {
      const session = await signedIn();
      await provider.close();
      try {
        const response = await api(t, '/v1/auth/logout', {
          method: 'POST',
          cookie: session.cookie,
          csrf: session.csrf,
        });
        expect(response.status).toBe(200);
        expect(await t.db.select().from(sessions)).toHaveLength(0);
      } finally {
        provider = await startFakeOidc({
          port: Number(new URL(provider.issuer).port),
          users: [ann, bob],
          clients: [TEST_CLIENT],
        });
      }
    });
  });
});
