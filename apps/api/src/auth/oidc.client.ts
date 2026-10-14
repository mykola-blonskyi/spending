import { Inject, Injectable } from '@nestjs/common';
import * as oidc from 'openid-client';
import { APP_CONFIG, type AppConfig } from '../common/config';

const SCOPE = 'openid profile email offline_access';
const PROVIDER_TIMEOUT_SECONDS = 5;

export type LoginChecks = Readonly<{ state: string; nonce: string; codeVerifier: string }>;

export type ProviderTokens = Readonly<{
  claims: Record<string, unknown>;
  refreshToken: string | undefined;
  idToken: string | undefined;
}>;

export type RefreshOutcome =
  | { kind: 'refreshed'; refreshToken: string | undefined; idToken: string | undefined }
  | { kind: 'revoked' }
  | { kind: 'unavailable' };

/** Only `invalid_grant` proves the grant is gone; anything else may be a provider outage. */
export function classifyRefreshError(error: unknown): 'revoked' | 'unavailable' {
  return error instanceof oidc.ResponseBodyError && error.error === 'invalid_grant'
    ? 'revoked'
    : 'unavailable';
}

/** Thin wrapper over openid-client. Discovery is lazy so the API boots while the provider is down. */
@Injectable()
export class OidcClient {
  private configuration?: Promise<oidc.Configuration>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async startLogin(): Promise<LoginChecks & { url: URL }> {
    const configuration = await this.discover();
    const checks = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      codeVerifier: oidc.randomPKCECodeVerifier(),
    };
    const url = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.config.oidc.redirectUri,
      scope: SCOPE,
      state: checks.state,
      nonce: checks.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(checks.codeVerifier),
      code_challenge_method: 'S256',
    });
    return { ...checks, url };
  }

  /** Verifies state, nonce, PKCE, issuer, audience, signature and expiry; throws otherwise. */
  async exchangeCode(callbackUrl: URL, checks: LoginChecks): Promise<ProviderTokens> {
    const tokens = await oidc.authorizationCodeGrant(await this.discover(), callbackUrl, {
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      pkceCodeVerifier: checks.codeVerifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error('No ID token');
    return { claims, refreshToken: tokens.refresh_token, idToken: tokens.id_token };
  }

  async refresh(refreshToken: string): Promise<RefreshOutcome> {
    try {
      const tokens = await oidc.refreshTokenGrant(await this.discover(), refreshToken);
      return { kind: 'refreshed', refreshToken: tokens.refresh_token, idToken: tokens.id_token };
    } catch (error) {
      return { kind: classifyRefreshError(error) };
    }
  }

  async revoke(refreshToken: string): Promise<void> {
    await oidc.tokenRevocation(await this.discover(), refreshToken, {
      token_type_hint: 'refresh_token',
    });
  }

  async endSessionUrl(idToken: string): Promise<string> {
    const url = oidc.buildEndSessionUrl(await this.discover(), {
      id_token_hint: idToken,
      post_logout_redirect_uri: this.config.oidc.postLogoutRedirectUri,
    });
    return url.href;
  }

  private discover(): Promise<oidc.Configuration> {
    this.configuration ??= oidc
      .discovery(
        new URL(this.config.oidc.issuer),
        this.config.oidc.clientId,
        { id_token_signed_response_alg: 'RS256' },
        oidc.ClientSecretBasic(this.config.oidc.clientSecret),
        {
          timeout: PROVIDER_TIMEOUT_SECONDS,
          // oauth4webapi skips ID token signature checks for TLS token responses by default;
          // ADR-003 wants the signature verified regardless.
          execute: [
            oidc.enableNonRepudiationChecks,
            ...(this.config.env === 'test' ? [oidc.allowInsecureRequests] : []),
          ],
        },
      )
      .catch((error: unknown) => {
        this.configuration = undefined;
        throw error;
      });
    return this.configuration;
  }
}
