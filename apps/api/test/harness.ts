import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/bootstrap';
import { parseConfig } from '../src/common/config';
import { DB, type Db } from '../src/database/database.module';
import { testDatabaseUrl } from './env';

export type TestApp = { app: NestExpressApplication; db: Db; baseUrl: string };

export const TEST_APP_ORIGIN = 'http://app.test';
export const TEST_CLIENT = {
  clientId: 'spending-test',
  clientSecret: 'spending-test-secret',
  redirectUris: [`${TEST_APP_ORIGIN}/api/v1/auth/callback`],
  postLogoutRedirectUris: [`${TEST_APP_ORIGIN}/signin`],
} as const;

export async function startTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const app = await createApp(
    parseConfig({
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      APP_ORIGIN: TEST_APP_ORIGIN,
      OIDC_ISSUER: 'http://127.0.0.1:9',
      OIDC_CLIENT_ID: TEST_CLIENT.clientId,
      OIDC_CLIENT_SECRET: TEST_CLIENT.clientSecret,
      SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      ...env,
    }),
  );
  await app.listen(0, '127.0.0.1');
  return { app, db: app.get<Db>(DB), baseUrl: await app.getUrl() };
}

export async function resetData(db: Db): Promise<void> {
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename <> 'sync_epoch'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((row) => `"${row.tablename}"`).join(', ');
  await db.execute(sql.raw(`truncate ${tables} restart identity cascade`));
}

export const SESSION_COOKIE = '__Host-spending_session';
const LOGIN_COOKIE = '__Host-spending_login';

let ipCounter = 0;
/** A fresh client IP per call, so per-IP auth budgets never couple unrelated tests. */
export function freshIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export function sessionCookieFrom(response: Response): string | undefined {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const [name, value] = pair!.split('=');
    if (name === SESSION_COOKIE) return value;
  }
  return undefined;
}

export type LoginOutcome = { location: string; cookie: string | undefined; setCookie: string[] };

/**
 * Runs the browser side of the authorization code flow against the fake provider. The app
 * believes it lives at TEST_APP_ORIGIN, so the provider's redirect is replayed onto baseUrl.
 */
export async function login(
  t: TestApp,
  sub: string,
  options: {
    returnTo?: string;
    ip?: string;
    cookie?: string;
    /** Simulates the callback arriving in a browser that did not start the login. */
    withoutBinding?: boolean;
    beforeCallback?: () => Promise<void>;
  } = {},
): Promise<LoginOutcome & { callbackUrl: string }> {
  const ip = options.ip ?? freshIp();
  const query =
    options.returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(options.returnTo)}`;
  const start = await fetch(`${t.baseUrl}/api/v1/auth/login${query}`, {
    redirect: 'manual',
    headers: { 'x-forwarded-for': ip },
  });
  if (start.status !== 302) throw new Error(`login start returned ${start.status}`);
  const binding = start.headers
    .getSetCookie()
    .map((c) => /^(?:__Host-)?spending_login=([^;]+)/.exec(c)?.[1])
    .find(Boolean);
  const authorize = new URL(start.headers.get('location')!);
  authorize.searchParams.set('login_hint', sub);
  const provider = await fetch(authorize, { redirect: 'manual' });
  if (provider.status !== 302) throw new Error(`authorize returned ${provider.status}`);
  const back = new URL(provider.headers.get('location')!);
  const callbackUrl = `${t.baseUrl}${back.pathname}${back.search}`;
  await options.beforeCallback?.();
  const outcome = await callback(
    callbackUrl,
    ip,
    options.cookie,
    options.withoutBinding ? undefined : binding,
  );
  return { ...outcome, callbackUrl };
}

export async function callback(
  url: string,
  ip = freshIp(),
  cookie?: string,
  binding?: string,
): Promise<LoginOutcome> {
  const cookies = [
    cookie ? `${SESSION_COOKIE}=${cookie}` : undefined,
    binding ? `${LOGIN_COOKIE}=${binding}` : undefined,
  ].filter(Boolean);
  const response = await fetch(url, {
    redirect: 'manual',
    headers: {
      'x-forwarded-for': ip,
      ...(cookies.length > 0 ? { cookie: cookies.join('; ') } : {}),
    },
  });
  if (response.status !== 302) throw new Error(`callback returned ${response.status}`);
  return {
    location: response.headers.get('location')!,
    cookie: sessionCookieFrom(response),
    setCookie: response.headers.getSetCookie(),
  };
}

export type ApiRequest = {
  method?: string;
  cookie?: string;
  csrf?: string;
  origin?: string | null;
  secFetchSite?: string;
  body?: unknown;
};

/** Calls the API as a same-origin browser would, unless told otherwise. */
export function api(t: TestApp, path: string, request: ApiRequest = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (request.cookie) headers.cookie = `${SESSION_COOKIE}=${request.cookie}`;
  if (request.csrf) headers['x-csrf-token'] = request.csrf;
  const origin = request.origin === undefined ? TEST_APP_ORIGIN : request.origin;
  if (origin !== null) headers.origin = origin;
  if (request.secFetchSite) headers['sec-fetch-site'] = request.secFetchSite;
  if (request.body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${t.baseUrl}/api${path}`, {
    method: request.method ?? 'GET',
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });
}

export type Session = { cookie: string; csrf: string; userId: string };

/** Signs `sub` in through the fake provider and returns what a browser needs for API calls. */
export async function loginAs(t: TestApp, sub: string): Promise<Session> {
  const { cookie } = await login(t, sub);
  if (!cookie) throw new Error(`login of ${sub} set no session cookie`);
  const response = await api(t, '/v1/auth/session', { cookie });
  const body = (await response.json()) as { csrfToken: string; user: { id: string } };
  return { cookie, csrf: body.csrfToken, userId: body.user.id };
}

/** Calls the API as the signed-in `session`, with its CSRF token on unsafe methods. */
export function as(
  t: TestApp,
  session: Session,
  path: string,
  request: Omit<ApiRequest, 'cookie' | 'csrf'> = {},
): Promise<Response> {
  return api(t, path, { ...request, cookie: session.cookie, csrf: session.csrf });
}

async function body<T>(response: Response, status: number): Promise<T> {
  if (response.status !== status) {
    throw new Error(`expected ${status}, got ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export type Workspaces = { personal: string; family: string | null };

export async function workspacesOf(t: TestApp, session: Session): Promise<Workspaces> {
  const { workspaces } = await body<{ workspaces: { id: string; kind: string }[] }>(
    await as(t, session, '/v1/workspaces'),
    200,
  );
  return {
    personal: workspaces.find((w) => w.kind === 'personal')!.id,
    family: workspaces.find((w) => w.kind === 'family')?.id ?? null,
  };
}

/** Creates a family owned by `owner` and has every one of `members` join it. Returns its id. */
export async function createFamily(
  t: TestApp,
  owner: Session,
  ...members: Session[]
): Promise<string> {
  const { id } = await body<{ id: string }>(
    await as(t, owner, '/v1/family', { method: 'POST', body: { name: 'Home' } }),
    201,
  );
  for (const member of members) {
    const { url } = await body<{ url: string }>(
      await as(t, owner, '/v1/family/invitations', { method: 'POST', body: {} }),
      201,
    );
    const accepted = await as(t, member, `/v1/invitations/${url.split('/invite/')[1]}/accept`, {
      method: 'POST',
    });
    if (!accepted.ok) throw new Error(`accept returned ${accepted.status}`);
  }
  return id;
}

/** Category ids of a workspace by system key, for the seeded defaults. */
export async function categoriesOf(
  t: TestApp,
  session: Session,
  workspaceId: string,
): Promise<Record<string, string>> {
  const { categories } = await body<{ categories: { id: string; systemKey: string | null }[] }>(
    await as(t, session, `/v1/categories?workspaceId=${workspaceId}`),
    200,
  );
  return Object.fromEntries(categories.map((c) => [c.systemKey ?? c.id, c.id]));
}

/**
 * The live rows `session` sees, newest first as history orders them, read through the sync pull.
 * Pending-review rows come back only when asked for.
 */
export async function liveRows<T extends Record<string, unknown>>(
  t: TestApp,
  session: Session,
  reviewStatus: 'confirmed' | 'pending_review' = 'confirmed',
): Promise<T[]> {
  const { transactions } = await body<{ transactions: Record<string, unknown>[] }>(
    await as(t, session, '/v1/sync/pull?limit=1000'),
    200,
  );
  const key = (r: Record<string, unknown>) => `${r.occurredOn}|${r.createdAt}|${r.id}`;
  return transactions
    .filter((r) => r.reviewStatus === reviewStatus)
    .sort((a, b) => key(b).localeCompare(key(a))) as T[];
}

export type PushedRow = { id: string; version: number } & Record<string, unknown>;

/** Creates transactions through sync push and fails unless every one is applied. */
export async function pushNew(
  t: TestApp,
  session: Session,
  rows: (Record<string, unknown> & { workspaceId: string })[],
): Promise<PushedRow[]> {
  const mutations = rows.map((transaction) => ({
    mutationId: crypto.randomUUID(),
    type: 'transaction.upsert',
    baseVersion: null,
    transaction: {
      id: crypto.randomUUID(),
      kind: 'expense',
      amountMinor: 1000,
      currency: 'EUR',
      occurredOn: '2026-10-01',
      accountId: null,
      categoryId: null,
      description: '',
      note: '',
      ...transaction,
    },
  }));
  const { results } = await body<{ results: { status: string; transaction: PushedRow }[] }>(
    await as(t, session, '/v1/sync/push', { method: 'POST', body: { mutations } }),
    200,
  );
  const failed = results.filter((r) => r.status !== 'applied');
  if (failed.length > 0) throw new Error(`push not applied: ${JSON.stringify(failed)}`);
  return results.map((r) => r.transaction);
}

/** Tombstones a row through sync push. */
export async function pushDelete(t: TestApp, session: Session, row: PushedRow): Promise<void> {
  const { results } = await body<{ results: { status: string }[] }>(
    await as(t, session, '/v1/sync/push', {
      method: 'POST',
      body: {
        mutations: [
          {
            mutationId: crypto.randomUUID(),
            type: 'transaction.delete',
            transactionId: row.id,
            baseVersion: row.version,
          },
        ],
      },
    }),
    200,
  );
  if (results[0]?.status !== 'applied') throw new Error('delete not applied');
}
