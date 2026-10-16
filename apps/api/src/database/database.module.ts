import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../common/config';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** A Drizzle handle usable both at top level and inside `db.transaction`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;

export const DB = Symbol('DB');

/**
 * Runs `work` in a transaction that takes the ledger write lock before touching any row. Every
 * write to accounts, categories or transactions goes through here: the `ledger_stamp` trigger
 * takes the same lock, and taking it only after a row lock could deadlock two writers.
 */
export function ledgerTransaction<T>(db: Db, work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LEDGER_LOCK_KEY})`);
    return work(tx);
  });
}

export const LEDGER_LOCK_KEY = 7302001;

/** True when PostgreSQL gave up waiting: statement_timeout (57014) or lock_timeout (55P03). */
export function isTimeout(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return [error, cause].some((candidate) => {
    const code = (candidate as { code?: unknown } | null | undefined)?.code;
    return code === '57014' || code === '55P03';
  });
}

/** True for a PostgreSQL unique violation, optionally on one named constraint or index. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  return [error, cause].some((candidate) => {
    const pg = candidate as { code?: unknown; constraint?: unknown } | null | undefined;
    return pg?.code === '23505' && (constraint === undefined || pg.constraint === constraint);
  });
}
const POOL = Symbol('POOL');

@Global()
@Module({
  providers: [
    {
      provide: POOL,
      inject: [APP_CONFIG],
      // Bounds every wait, so one stuck writer cannot hold the pool forever. The longest measured
      // ledger lock holder is a family deletion at 1.4 s (reports/audits/2026-10-16-database.md).
      useFactory: (config: AppConfig) =>
        new Pool({
          connectionString: config.databaseUrl,
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000,
          statement_timeout: 30_000,
          lock_timeout: 10_000,
          idle_in_transaction_session_timeout: 60_000,
        }),
    },
    { provide: DB, inject: [POOL], useFactory: (pool: Pool): Db => drizzle(pool, { schema }) },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
