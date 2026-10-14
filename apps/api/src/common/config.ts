import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type AppConfig = Readonly<{
  env: 'development' | 'test' | 'production';
  port: number;
}>;

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid configuration: ${fields}`);
  }
  return { env: result.data.NODE_ENV, port: result.data.PORT };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
