import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOpenApi, createApp } from '../src/bootstrap';
import { parseConfig } from '../src/common/config';

async function main(): Promise<void> {
  const app = await createApp(
    parseConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://openapi@localhost/openapi',
      APP_ORIGIN: 'http://app.test',
      OIDC_ISSUER: 'http://issuer.test',
      OIDC_CLIENT_ID: 'openapi',
      OIDC_CLIENT_SECRET: 'openapi',
      SESSION_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    }),
  );
  const target = resolve(__dirname, '../../web/src/data/openapi.json');
  writeFileSync(target, `${JSON.stringify(buildOpenApi(app), null, 2)}\n`);
  await app.close();
}

void main();
