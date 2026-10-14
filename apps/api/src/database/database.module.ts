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
const POOL = Symbol('POOL');

@Global()
@Module({
  providers: [
    {
      provide: POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000 }),
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
