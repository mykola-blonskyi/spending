import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, lt, sql } from 'drizzle-orm';
import { DB, type Db } from '../database/database.module';
import { loginAttempts } from '../database/schema';
import { identityFromClaims } from '../users/profile';
import { UsersService } from '../users/users.service';
import { OidcClient, type ProviderTokens } from './oidc.client';
import { sanitizeReturnTo } from './return-to';
import { type IssuedSession, SessionService } from './session.service';
import { hashToken } from './token-crypto';

const LOGIN_ATTEMPT_TTL_MS = 10 * 60_000;

export type LoginResult =
  | { ok: true; session: IssuedSession; returnTo: string }
  | { ok: false; error: 'login_failed' | 'login_expired' };

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OidcClient) private readonly oidc: OidcClient,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  /** Returns where to send the browser: the provider, or back to sign-in if it is unreachable. */
  async startLogin(returnTo: unknown): Promise<string> {
    let login: Awaited<ReturnType<OidcClient['startLogin']>>;
    try {
      login = await this.oidc.startLogin();
    } catch {
      this.logger.warn('login_failed reason=discovery_unavailable');
      return '/signin?error=login_failed';
    }
    await this.db.delete(loginAttempts).where(lt(loginAttempts.expiresAt, sql`now()`));
    await this.db.insert(loginAttempts).values({
      state: login.state,
      nonce: login.nonce,
      codeVerifier: login.codeVerifier,
      returnTo: sanitizeReturnTo(returnTo),
      expiresAt: new Date(Date.now() + LOGIN_ATTEMPT_TTL_MS),
    });
    return login.url.href;
  }

  async completeLogin(callbackUrl: URL, previousToken: string | undefined): Promise<LoginResult> {
    const state = callbackUrl.searchParams.get('state');
    if (!state) return this.fail('missing_state');
    // Consuming before the exchange makes every state single-use, even when the exchange fails.
    const [attempt] = await this.db
      .delete(loginAttempts)
      .where(eq(loginAttempts.state, state))
      .returning();
    if (!attempt) return this.fail('unknown_state');
    if (attempt.expiresAt.getTime() <= Date.now()) {
      this.logger.warn('login_failed reason=attempt_expired');
      return { ok: false, error: 'login_expired' };
    }
    let tokens: ProviderTokens;
    try {
      tokens = await this.oidc.exchangeCode(callbackUrl, attempt);
    } catch (error) {
      return this.fail(`exchange_${error instanceof Error ? error.name : 'unknown'}`);
    }
    const identity = identityFromClaims(tokens.claims);
    if (!identity) return this.fail('claims_invalid');

    const session = await this.db.transaction(async (tx) => {
      const { userId } = await this.users.provision(tx, identity);
      return this.sessions.create(tx, userId, tokens);
    });
    if (previousToken) await this.sessions.destroy(hashToken(previousToken));
    await this.sessions.deleteExpired();
    return { ok: true, session, returnTo: attempt.returnTo };
  }

  /** Returns the provider's RP-initiated logout URL, or null when it cannot be built. */
  async logout(sessionTokenHash: string): Promise<string | null> {
    const idToken = await this.sessions.destroy(sessionTokenHash);
    if (!idToken) return null;
    try {
      return await this.oidc.endSessionUrl(idToken);
    } catch {
      return null;
    }
  }

  private fail(reason: string): LoginResult {
    this.logger.warn(`login_failed reason=${reason}`);
    return { ok: false, error: 'login_failed' };
  }
}
