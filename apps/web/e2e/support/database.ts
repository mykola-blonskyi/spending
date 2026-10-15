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

  /** The user's transactions as the server holds them, deleted ones included. */
  async transactions(email: string) {
    const { rows } = await this.pool.query<{
      id: string;
      amount_minor: string;
      description: string;
      version: number;
      deleted: boolean;
    }>(
      `select t.id, t.amount_minor, t.description, t.version, t.deleted_at is not null as deleted
         from transactions t join users u on u.id = t.created_by
        where u.email = $1 order by t.created_at`,
      [email],
    );
    return rows.map((row) => ({ ...row, amount_minor: Number(row.amount_minor) }));
  }

  /** The user's accounts as the server holds them, archived ones included. */
  async accounts(email: string) {
    const { rows } = await this.pool.query<{
      name: string;
      kind: string;
      currency: string;
      archived: boolean;
    }>(
      `select a.name, a.kind, a.currency, a.archived_at is not null as archived
         from accounts a
         join memberships m on m.workspace_id = a.workspace_id
         join users u on u.id = m.user_id
        where u.email = $1 order by a.created_at, a.name`,
      [email],
    );
    return rows;
  }

  /** The user's categories as the server holds them, archived ones included. */
  async categories(email: string) {
    const { rows } = await this.pool.query<{
      name: string;
      kind: string;
      color: string;
      icon: string;
      archived: boolean;
    }>(
      `select c.name, c.kind, c.color, c.icon, c.archived_at is not null as archived
         from categories c
         join memberships m on m.workspace_id = c.workspace_id
         join users u on u.id = m.user_id
        where u.email = $1 order by c.created_at, c.name`,
      [email],
    );
    return rows;
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
