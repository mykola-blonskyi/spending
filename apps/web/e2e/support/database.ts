import pg from 'pg';
import { E2E_DATABASE_URL } from './env';

export class E2EDatabase {
  private readonly pool = new pg.Pool({ connectionString: E2E_DATABASE_URL, max: 2 });

  /** Every test starts from empty tables; the schema and migrations stay. */
  async truncateAll(): Promise<void> {
    const { rows } = await this.pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    if (rows.length === 0) return;
    const tables = rows.map((row) => `"${row.tablename}"`).join(', ');
    await this.pool.query(`truncate ${tables} restart identity cascade`);
  }

  /** What revocation or expiry looks like to the app: the session row is gone. */
  async endSessions(email: string): Promise<number> {
    const result = await this.pool.query(
      'delete from sessions using users where sessions.user_id = users.id and users.email = $1',
      [email],
    );
    return result.rowCount ?? 0;
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
