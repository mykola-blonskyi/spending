import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/** Applies all pending migrations in one transaction, so a failure applies none; reruns are no-ops. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: resolve(__dirname, '../../drizzle') });
  } finally {
    await pool.end();
  }
}

/** The schema owner's URL when the roles are split (docs/operations.md), else the app's. */
export function migrationDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  return env.MIGRATION_DATABASE_URL || env.DATABASE_URL;
}

if (require.main === module) {
  const url = migrationDatabaseUrl(process.env);
  if (!url) throw new Error('DATABASE_URL is required');
  runMigrations(url).catch((error: unknown) => {
    process.stderr.write(
      `Migration failed: ${error instanceof Error ? error.message : 'unknown'}\n`,
    );
    process.exit(1);
  });
}
