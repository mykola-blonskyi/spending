import { Client } from 'pg';
import { runMigrations } from '../src/database/migrate';
import { testDatabaseUrl } from './env';

/** Rebuilds the test database from the migrations, so every run starts from the real schema. */
export default async function setup(): Promise<void> {
  const client = new Client({ connectionString: testDatabaseUrl });
  await client.connect();
  try {
    await client.query('drop schema if exists public cascade');
    await client.query('drop schema if exists drizzle cascade');
    await client.query('create schema public');
  } finally {
    await client.end();
  }
  await runMigrations(testDatabaseUrl);
}
