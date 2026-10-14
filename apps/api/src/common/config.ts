import { z } from 'zod';

const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

const encryptionKey = z
  .string()
  .transform((value) => Buffer.from(value, 'base64'))
  .refine((key) => key.length === 32, 'must be base64 of exactly 32 bytes');

const httpUrl = z.url({ protocol: /^https?$/ });

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    APP_ORIGIN: httpUrl.refine((value) => new URL(value).origin === value, 'must be a bare origin'),
    OIDC_ISSUER: httpUrl,
    OIDC_CLIENT_ID: z.string().min(1),
    OIDC_CLIENT_SECRET: z.string().min(1),
    SESSION_ENCRYPTION_KEY: encryptionKey,
    COOKIE_SECURE: booleanFlag.default(true),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['APP_ORIGIN', 'OIDC_ISSUER'] as const) {
      if (!env[key].startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'must be https in production' });
      }
    }
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true' });
    }
  });

export type AppConfig = Readonly<{
  env: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  appOrigin: string;
  oidc: Readonly<{
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    postLogoutRedirectUri: string;
  }>;
  sessionEncryptionKey: Buffer;
  cookieSecure: boolean;
}>;

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid configuration: ${fields}`);
  }
  const data = result.data;
  return {
    env: data.NODE_ENV,
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    appOrigin: data.APP_ORIGIN,
    oidc: {
      issuer: data.OIDC_ISSUER,
      clientId: data.OIDC_CLIENT_ID,
      clientSecret: data.OIDC_CLIENT_SECRET,
      redirectUri: `${data.APP_ORIGIN}/api/v1/auth/callback`,
      postLogoutRedirectUri: `${data.APP_ORIGIN}/signin`,
    },
    sessionEncryptionKey: data.SESSION_ENCRYPTION_KEY,
    cookieSecure: data.COOKIE_SECURE,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
