// Started by Playwright as `node e2e/support/start-api.ts` (Node strips the types). It rebuilds the
// E2E database from the migrations, then runs the built API in this same process, so the stop
// signal reaches the server directly.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const apiDist = new URL('../../../api/dist/', import.meta.url);
const databaseUrl = process.env.DATABASE_URL ?? '';
const database = new URL(databaseUrl).pathname.slice(1);

if (!/^\w+_e2e$/.test(database)) {
  throw new Error(`Refusing to reset "${database}": E2E databases must end in _e2e`);
}
if (!existsSync(new URL('main.js', apiDist))) {
  throw new Error('The API is not built. Run `pnpm build` before `pnpm test:e2e`.');
}

async function withClient(url: string, run: (client: pg.Client) => Promise<unknown>) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

const serverUrl = new URL(databaseUrl);
serverUrl.pathname = '/postgres';
await withClient(serverUrl.href, async (client) => {
  const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [
    database,
  ]);
  if (rowCount === 0) await client.query(`create database "${database}"`);
});
await withClient(databaseUrl, async (client) => {
  await client.query('drop schema if exists public cascade');
  await client.query('drop schema if exists drizzle cascade');
  await client.query('create schema public');
});

const { runMigrations } = require(new URL('database/migrate.js', apiDist).pathname);
await runMigrations(databaseUrl);
require(new URL('main.js', apiDist).pathname);
