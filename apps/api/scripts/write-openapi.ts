import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOpenApi, createApp } from '../src/bootstrap';
import { parseConfig } from '../src/common/config';

async function main(): Promise<void> {
  const app = await createApp(parseConfig({ NODE_ENV: 'test' }));
  const target = resolve(__dirname, '../../web/src/data/openapi.json');
  writeFileSync(target, `${JSON.stringify(buildOpenApi(app), null, 2)}\n`);
  await app.close();
}

void main();
