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
      scope: 'personal' | 'family';
    }>(
      `select t.id, t.amount_minor, t.description, t.version, t.deleted_at is not null as deleted,
              w.kind as scope
         from transactions t join users u on u.id = t.created_by
         join workspaces w on w.id = t.workspace_id
        where u.email = $1 order by t.created_at`,
      [email],
    );
    return rows.map((row) => ({ ...row, amount_minor: Number(row.amount_minor) }));
  }

  /** History as the server holds it: where each row lives, its review state and category. */
  async history(email: string) {
    const { rows } = await this.pool.query<{
      description: string;
      amount_minor: string;
      scope: string;
      review_status: string;
      category: string | null;
      version: number;
      deleted: boolean;
    }>(
      `select t.description, t.amount_minor, w.kind as scope, t.review_status,
              c.name as category, t.version, t.deleted_at is not null as deleted
         from transactions t
         join users u on u.id = t.created_by
         join workspaces w on w.id = t.workspace_id
         left join categories c on c.id = t.category_id
        where u.email = $1 order by t.occurred_on, t.created_at, t.id`,
      [email],
    );
    return rows.map((row) => ({ ...row, amount_minor: Number(row.amount_minor) }));
  }

  /** What the categorizer learned, per merchant key. */
  async categoryRules(email: string) {
    const { rows } = await this.pool.query<{ merchant_key: string; category: string }>(
      `select r.merchant_key, c.name as category
         from category_rules r
         join categories c on c.id = r.category_id
         join workspaces w on w.id = r.workspace_id
         join users u on u.id = w.owner_id
        where u.email = $1 order by r.merchant_key`,
      [email],
    );
    return rows;
  }

  /** The user's recurring rules as the server holds them. */
  async recurringRules(email: string) {
    const { rows } = await this.pool.query<{
      id: string;
      paused: boolean;
      next_occurrence: string | null;
    }>(
      `select r.id, r.paused_at is not null as paused, r.next_occurrence::text as next_occurrence
         from recurring_rules r join users u on u.id = r.created_by
        where u.email = $1 order by r.created_at`,
      [email],
    );
    return rows;
  }

  /** Every invitation link is past its expiry from now on. */
  async expireInvitations(): Promise<void> {
    await this.pool.query("update invitations set expires_at = now() - interval '1 minute'");
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
