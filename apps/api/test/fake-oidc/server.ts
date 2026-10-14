import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, type CryptoKey, SignJWT } from 'jose';

export type FakeUser = Readonly<{
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  locale?: string;
  theme?: string;
}>;

export type FakeClient = Readonly<{
  clientId: string;
  clientSecret: string;
  redirectUris: readonly string[];
  postLogoutRedirectUris: readonly string[];
}>;

export type Tamper = 'wrongAudience' | 'wrongIssuer' | 'expired' | 'badSignature' | 'wrongNonce';

export type FakeOidcOptions = Readonly<{
  port?: number;
  host?: string;
  users: readonly FakeUser[];
  clients: readonly FakeClient[];
}>;

type CodeGrant = {
  clientId: string;
  sub: string;
  redirectUri: string;
  nonce: string | undefined;
  codeChallenge: string;
  scope: string;
};

type RefreshRecord = { clientId: string; sub: string; family: string; used: boolean };

const KID = 'fake-oidc-1';
const TOKEN_TTL_SECONDS = 300;

/**
 * A minimal OIDC provider that behaves like login.blonskyi.dev where it matters: confidential
 * clients with client_secret_basic, mandatory PKCE S256, RS256 ID tokens, refresh token rotation
 * with reuse detection, per-user grant revocation and RP-initiated logout.
 */
export async function startFakeOidc(options: FakeOidcOptions) {
  const signing = await generateKeyPair('RS256', { extractable: true });
  const impostor = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(signing.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };

  const users = new Map(options.users.map((user) => [user.sub, user]));
  const clients = new Map(options.clients.map((client) => [client.clientId, client]));
  const codes = new Map<string, CodeGrant>();
  const refreshTokens = new Map<string, RefreshRecord>();
  const revokedFamilies = new Set<string>();
  const revokedSubs = new Set<string>();
  const counters = { refresh: 0, revocations: 0 };
  let tamper: Tamper | null = null;
  let outage = false;
  let issuer = '';

  async function idToken(clientId: string, user: FakeUser, nonce: string | undefined) {
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      email: user.email,
      name: user.name,
      picture: user.picture,
      locale: user.locale,
      'https://blonskyi.dev/theme': user.theme,
    };
    const nonceClaim = tamper === 'wrongNonce' ? 'not-the-nonce' : nonce;
    if (nonceClaim) claims.nonce = nonceClaim;
    const key: CryptoKey = tamper === 'badSignature' ? impostor.privateKey : signing.privateKey;
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(tamper === 'wrongIssuer' ? 'https://impostor.example' : issuer)
      .setAudience(tamper === 'wrongAudience' ? 'another-client' : clientId)
      .setSubject(user.sub)
      .setIssuedAt(tamper === 'expired' ? now - 2 * TOKEN_TTL_SECONDS : now)
      .setExpirationTime(tamper === 'expired' ? now - TOKEN_TTL_SECONDS : now + TOKEN_TTL_SECONDS)
      .sign(key);
  }

  function issueRefresh(clientId: string, sub: string, family = randomToken()): string {
    const token = randomToken();
    refreshTokens.set(token, { clientId, sub, family, used: false });
    return token;
  }

  function authenticateClient(req: IncomingMessage): FakeClient | undefined {
    const match = /^Basic (.+)$/.exec(req.headers.authorization ?? '');
    if (!match) return undefined;
    const decoded = Buffer.from(match[1]!, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const id = decodeURIComponent(decoded.slice(0, separator));
    const secret = decodeURIComponent(decoded.slice(separator + 1));
    const client = clients.get(id);
    return client && client.clientSecret === secret ? client : undefined;
  }

  function authorize(url: URL, res: ServerResponse): void {
    const q = url.searchParams;
    const client = clients.get(q.get('client_id') ?? '');
    const redirectUri = q.get('redirect_uri') ?? '';
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return text(res, 400, 'invalid client or redirect_uri');
    }
    const back = new URL(redirectUri);
    const state = q.get('state');
    if (state) back.searchParams.set('state', state);
    const challenge = q.get('code_challenge');
    if (
      q.get('response_type') !== 'code' ||
      q.get('code_challenge_method') !== 'S256' ||
      !challenge
    ) {
      back.searchParams.set('error', 'invalid_request');
      return redirect(res, back.href);
    }
    const hint = q.get('login_hint');
    const user = hint ? users.get(hint) : undefined;
    if (!user) return loginPage(res, url);
    if (revokedSubs.has(user.sub)) return text(res, 403, 'Access to this project is not granted');
    const code = randomToken();
    codes.set(code, {
      clientId: client.clientId,
      sub: user.sub,
      redirectUri,
      nonce: q.get('nonce') ?? undefined,
      codeChallenge: challenge,
      scope: q.get('scope') ?? '',
    });
    back.searchParams.set('code', code);
    redirect(res, back.href);
  }

  function loginPage(res: ServerResponse, url: URL): void {
    const buttons = [...users.values()]
      .map((user) => {
        const target = new URL(url);
        target.searchParams.set('login_hint', user.sub);
        return `<li><a href="${escapeHtml(target.pathname + target.search)}">Sign in as ${escapeHtml(user.name ?? user.email)}</a></li>`;
      })
      .join('');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><title>Fake OIDC</title><h1>Choose a test user</h1><ul>${buttons}</ul>`,
    );
  }

  async function token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = new URLSearchParams(await readBody(req));
    if (outage) return json(res, 503, { error: 'temporarily_unavailable' });
    const client = authenticateClient(req);
    if (!client) return json(res, 401, { error: 'invalid_client' });
    const grantType = form.get('grant_type');

    if (grantType === 'authorization_code') {
      const code = form.get('code') ?? '';
      const grant = codes.get(code);
      codes.delete(code);
      if (!grant || grant.clientId !== client.clientId) return invalidGrant(res);
      if (form.get('redirect_uri') !== grant.redirectUri) return invalidGrant(res);
      const verifier = form.get('code_verifier') ?? '';
      if (createHash('sha256').update(verifier).digest('base64url') !== grant.codeChallenge) {
        return invalidGrant(res);
      }
      const user = users.get(grant.sub);
      if (!user || revokedSubs.has(user.sub)) return invalidGrant(res);
      return json(res, 200, {
        access_token: randomToken(),
        token_type: 'Bearer',
        expires_in: TOKEN_TTL_SECONDS,
        scope: grant.scope,
        id_token: await idToken(client.clientId, user, grant.nonce),
        ...(grant.scope.split(' ').includes('offline_access')
          ? { refresh_token: issueRefresh(client.clientId, user.sub) }
          : {}),
      });
    }

    if (grantType === 'refresh_token') {
      counters.refresh += 1;
      const record = refreshTokens.get(form.get('refresh_token') ?? '');
      if (!record || record.clientId !== client.clientId) return invalidGrant(res);
      if (record.used) {
        revokedFamilies.add(record.family);
        return invalidGrant(res);
      }
      record.used = true;
      const user = users.get(record.sub);
      if (!user || revokedFamilies.has(record.family) || revokedSubs.has(record.sub)) {
        return invalidGrant(res);
      }
      return json(res, 200, {
        access_token: randomToken(),
        token_type: 'Bearer',
        expires_in: TOKEN_TTL_SECONDS,
        refresh_token: issueRefresh(client.clientId, record.sub, record.family),
        id_token: await idToken(client.clientId, user, undefined),
      });
    }

    json(res, 400, { error: 'unsupported_grant_type' });
  }

  async function revoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = new URLSearchParams(await readBody(req));
    const client = authenticateClient(req);
    if (!client) return json(res, 401, { error: 'invalid_client' });
    const record = refreshTokens.get(form.get('token') ?? '');
    if (record && record.clientId === client.clientId) revokedFamilies.add(record.family);
    counters.revocations += 1;
    res.writeHead(200).end();
  }

  function logout(url: URL, res: ServerResponse): void {
    const target = url.searchParams.get('post_logout_redirect_uri');
    const allowed = [...clients.values()].some(
      (c) => target && c.postLogoutRedirectUris.includes(target),
    );
    if (target && allowed) return redirect(res, target);
    text(res, 200, 'Signed out');
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const route = `${req.method} ${url.pathname}`;
    const handle = async () => {
      switch (route) {
        case 'GET /.well-known/openid-configuration':
          return json(res, 200, {
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            revocation_endpoint: `${issuer}/revoke`,
            end_session_endpoint: `${issuer}/logout`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            token_endpoint_auth_methods_supported: ['client_secret_basic'],
            code_challenge_methods_supported: ['S256'],
            scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
          });
        case 'GET /jwks':
          return json(res, 200, { keys: [jwk] });
        case 'GET /authorize':
          return authorize(url, res);
        case 'POST /token':
          return token(req, res);
        case 'POST /revoke':
          return revoke(req, res);
        case 'GET /logout':
          return logout(url, res);
        default:
          return text(res, 404, 'not found');
      }
    };
    handle().catch(() => {
      if (!res.headersSent) text(res, 500, 'fake provider error');
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve),
  );
  const address = server.address() as AddressInfo;
  issuer = `http://${options.host ?? '127.0.0.1'}:${address.port}`;

  return {
    issuer,
    /** Simulates the owner removing the user's project grant (or blocking the user). */
    revokeGrant(sub: string) {
      revokedSubs.add(sub);
    },
    restoreGrant(sub: string) {
      revokedSubs.delete(sub);
    },
    setTamper(next: Tamper | null) {
      tamper = next;
    },
    /** While on, the token endpoint answers 503. */
    setOutage(next: boolean) {
      outage = next;
    },
    setUser(user: FakeUser) {
      users.set(user.sub, user);
    },
    get refreshCalls() {
      return counters.refresh;
    },
    get revocations() {
      return counters.revocations;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

export type FakeOidc = Awaited<ReturnType<typeof startFakeOidc>>;

function randomToken(): string {
  return randomBytes(24).toString('base64url');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function invalidGrant(res: ServerResponse): void {
  json(res, 400, { error: 'invalid_grant' });
}

function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location });
  res.end();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
