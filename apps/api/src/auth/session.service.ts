import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../common/config';
import { ApiError } from '../common/errors';
import type { Actor } from '../common/actor';
import { DB, type Db, type Tx } from '../database/database.module';
import { sessions } from '../database/schema';
import { OidcClient } from './oidc.client';
import { decideSession, SESSION_POLICY } from './session-policy';
import { decryptSecret, encryptSecret, hashToken, randomToken } from './token-crypto';

export type IssuedSession = Readonly<{ token: string; expiresAt: Date }>;

export type Authentication = Readonly<{ actor: Actor; rotated: IssuedSession | undefined }>;

const REVOKE_TIMEOUT_MS = 3000;

const olderThan = (column: typeof sessions.lastSeenAt, ms: number) =>
  lt(column, sql`now() - make_interval(secs => ${ms / 1000})`);

/** A presented token may be the session's current one or, during the grace window, its predecessor. */
const byToken = (hash: string) =>
  or(eq(sessions.tokenHash, hash), eq(sessions.previousTokenHash, hash));

@Injectable()
export class SessionService {
  private readonly logger = new Logger('Sessions');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OidcClient) private readonly oidc: OidcClient,
  ) {}

  async create(
    tx: Tx,
    userId: string,
    tokens: { refreshToken: string | undefined; idToken: string | undefined },
  ): Promise<IssuedSession> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + SESSION_POLICY.absoluteLifetimeMs);
    await tx.insert(sessions).values({
      tokenHash: hashToken(token),
      userId,
      csrfToken: randomToken(),
      refreshTokenEnc: this.encrypt(tokens.refreshToken),
      idTokenEnc: this.encrypt(tokens.idToken),
      expiresAt,
    });
    return { token, expiresAt };
  }

  /** Throws AUTH_REQUIRED or SESSION_REVOKED; otherwise returns the actor and any rotated token. */
  async authenticate(token: string): Promise<Authentication> {
    const hash = hashToken(token);
    const [row] = await this.db.select().from(sessions).where(byToken(hash));
    if (!row) throw new ApiError('AUTH_REQUIRED');
    const match = row.tokenHash === hash ? 'current' : 'previous';
    const decision = decideSession(row, match, new Date());
    if (decision.status === 'expired') {
      // A replaced token past its grace window must not take the live session down with it.
      if (match === 'current') await this.db.delete(sessions).where(eq(sessions.tokenHash, hash));
      throw new ApiError('AUTH_REQUIRED');
    }
    if (decision.checkGrant) await this.recheckGrant(hash);
    let rotated: IssuedSession | undefined;
    if (decision.rotate) rotated = await this.rotate(hash);
    else if (decision.touch) await this.touch(hash);
    return {
      actor: { userId: row.userId, sessionTokenHash: hash, csrfToken: row.csrfToken },
      rotated,
    };
  }

  /** Deletes the session and best-effort revokes its refresh token. Returns the ID token, if any. */
  async destroy(hash: string): Promise<string | undefined> {
    const [row] = await this.db
      .delete(sessions)
      .where(byToken(hash))
      .returning({ refreshTokenEnc: sessions.refreshTokenEnc, idTokenEnc: sessions.idTokenEnc });
    const refreshToken = this.decrypt(row?.refreshTokenEnc);
    if (refreshToken) await this.revokeOneQuietly(refreshToken);
    return this.decrypt(row?.idTokenEnc);
  }

  /**
   * Deletes every session of `userId` inside `tx` and returns their refresh tokens, so the caller
   * can revoke them with `revokeQuietly` once `tx` has committed.
   */
  async deleteAllOf(tx: Tx, userId: string): Promise<string[]> {
    const rows = await tx
      .delete(sessions)
      .where(eq(sessions.userId, userId))
      .returning({ refreshTokenEnc: sessions.refreshTokenEnc });
    return rows.flatMap((row) => this.decrypt(row.refreshTokenEnc) ?? []);
  }

  /** Best effort: a provider that fails or times out is logged, never surfaced. */
  async revokeQuietly(refreshTokens: readonly string[]): Promise<void> {
    await Promise.all(refreshTokens.map((token) => this.revokeOneQuietly(token)));
  }

  async deleteExpired(): Promise<void> {
    await this.db
      .delete(sessions)
      .where(
        or(
          lt(sessions.expiresAt, sql`now()`),
          olderThan(sessions.lastSeenAt, SESSION_POLICY.idleTimeoutMs),
        ),
      );
  }

  /**
   * ADR-003 grant re-check. The conditional UPDATE lets exactly one concurrent request claim the
   * check; the others proceed on the current grant rather than reusing the same refresh token,
   * which the provider would treat as replay and revoke the whole chain.
   */
  private async recheckGrant(hash: string): Promise<void> {
    const [claim] = await this.db
      .update(sessions)
      .set({ grantCheckedAt: sql`now()` })
      .where(
        and(
          eq(sessions.tokenHash, hash),
          olderThan(sessions.grantCheckedAt, SESSION_POLICY.grantCheckEveryMs),
        ),
      )
      .returning({ refreshTokenEnc: sessions.refreshTokenEnc });
    if (!claim) return;
    const refreshToken = this.decrypt(claim.refreshTokenEnc);
    const outcome = refreshToken
      ? await this.oidc.refresh(refreshToken)
      : { kind: 'revoked' as const };
    if (outcome.kind === 'unavailable') {
      this.logger.warn('grant_check_unavailable');
      return;
    }
    if (outcome.kind === 'revoked') {
      await this.db.delete(sessions).where(byToken(hash));
      throw new ApiError('SESSION_REVOKED');
    }
    // byToken: a concurrent rotation may have moved this hash to previous_token_hash meanwhile.
    await this.db
      .update(sessions)
      .set({
        ...(outcome.refreshToken ? { refreshTokenEnc: this.encrypt(outcome.refreshToken) } : {}),
        ...(outcome.idToken ? { idTokenEnc: this.encrypt(outcome.idToken) } : {}),
      })
      .where(byToken(hash));
  }

  /**
   * Rotates in place: the row keeps its grant data and the old hash stays valid for the grace
   * window. Only the request whose UPDATE matches wins; a loser is served on the old token.
   */
  private async rotate(hash: string): Promise<IssuedSession | undefined> {
    const token = randomToken();
    const [row] = await this.db
      .update(sessions)
      .set({
        tokenHash: hashToken(token),
        previousTokenHash: hash,
        rotatedAt: sql`now()`,
        lastSeenAt: sql`now()`,
      })
      .where(
        and(
          eq(sessions.tokenHash, hash),
          olderThan(sessions.rotatedAt, SESSION_POLICY.rotateAfterMs),
        ),
      )
      .returning({ expiresAt: sessions.expiresAt });
    return row ? { token, expiresAt: row.expiresAt } : undefined;
  }

  private async touch(hash: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ lastSeenAt: sql`now()` })
      .where(
        and(
          eq(sessions.tokenHash, hash),
          olderThan(sessions.lastSeenAt, SESSION_POLICY.touchEveryMs),
        ),
      );
  }

  private async revokeOneQuietly(refreshToken: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), REVOKE_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([this.oidc.revoke(refreshToken), timeout]);
      if (result === 'timeout') this.logger.warn('token_revocation_timeout');
    } catch {
      this.logger.warn('token_revocation_failed');
    } finally {
      clearTimeout(timer);
    }
  }

  private encrypt(value: string | undefined): string | null {
    return value ? encryptSecret(this.config.sessionEncryptionKey, value) : null;
  }

  /** A secret that no longer decrypts (key changed, tampering) is treated as absent. */
  private decrypt(value: string | null | undefined): string | undefined {
    if (!value) return undefined;
    try {
      return decryptSecret(this.config.sessionEncryptionKey, value);
    } catch {
      this.logger.warn('session_secret_undecryptable');
      return undefined;
    }
  }
}
