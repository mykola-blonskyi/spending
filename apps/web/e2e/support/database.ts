import pg from 'pg';
import { E2E_DATABASE_URL } from './env';

export class E2EDatabase {
  private readonly pool = new pg.Pool({ connectionString: E2E_DATABASE_URL, max: 2 });

  /** Every test starts from empty tables; the schema, migrations and sync epoch stay. */
  async truncateAll(): Promise<void> {
    const { rows } = await this.pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> 'sync_epoch'",
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
      revision: string;
      base_amount_minor: string | null;
      deleted: boolean;
      scope: 'personal' | 'family';
      kind: 'income' | 'expense';
      currency: string;
      transfer_id: string | null;
    }>(
      `select t.id, t.amount_minor, t.description, t.version, t.revision, t.base_amount_minor,
              t.deleted_at is not null as deleted, w.kind as scope, t.kind, t.currency,
              t.transfer_id
         from transactions t join users u on u.id = t.created_by
         join workspaces w on w.id = t.workspace_id
        where u.email = $1 order by t.created_at`,
      [email],
    );
    return rows.map((row) => ({
      ...row,
      amount_minor: Number(row.amount_minor),
      revision: Number(row.revision),
      base_amount_minor: row.base_amount_minor === null ? null : Number(row.base_amount_minor),
    }));
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
      `select coalesce(c.name, c.system_key) as name, c.kind, c.color, c.icon,
              c.archived_at is not null as archived
         from categories c
         join memberships m on m.workspace_id = c.workspace_id
         join users u on u.id = m.user_id
        where u.email = $1 order by c.created_at, c.name`,
      [email],
    );
    return rows;
  }

  async insertFxRate(rate: { date: string; currency: string; ratePerEur: string; source: string }) {
    await this.pool.query(
      `insert into fx_rates (date, currency, rate_per_eur, source) values ($1, $2, $3, $4)
       on conflict (currency, date) do update set rate_per_eur = excluded.rate_per_eur`,
      [rate.date, rate.currency, rate.ratePerEur, rate.source],
    );
  }

  /**
   * What the API's FX backfill does to the user's unconverted rows (BR-14): the conversion
   * columns change, the `ledger_stamp` trigger bumps `revision`, and `version` stays.
   * shortcut: rounds half up and assumes 2-decimal currencies; the API rounds half even by ISO
   * exponent, so keep test amounts away from ties and 0- or 3-decimal currencies.
   */
  async backfillConversions(email: string): Promise<number> {
    const result = await this.pool.query(
      `with picked as (
         select t.id, r.date, r.rate_per_eur, r.source
           from transactions t
           join users u on u.id = t.created_by
          cross join lateral (
            select date, rate_per_eur, source from fx_rates
             where currency = t.currency and date between t.occurred_on - 7 and t.occurred_on
             order by date desc limit 1
          ) r
          where u.email = $1 and t.currency <> 'EUR' and t.base_amount_minor is null
       )
       update transactions t
          set base_amount_minor = round(t.amount_minor / p.rate_per_eur),
              fx_rate = p.rate_per_eur, fx_rate_date = p.date, fx_source = p.source
         from picked p
        where t.id = p.id`,
      [email],
    );
    return result.rowCount ?? 0;
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
      currency: string;
      occurred_on: string;
    }>(
      `select t.description, t.amount_minor, t.currency, t.occurred_on::text as occurred_on,
              w.kind as scope, t.review_status,
              coalesce(c.name, c.system_key) as category, t.version,
              t.deleted_at is not null as deleted
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
      `select r.merchant_key, coalesce(c.name, c.system_key) as category
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

  /** Where each pending sign-in returns to, as the server stores it. */
  async loginReturnTargets(): Promise<string[]> {
    const { rows } = await this.pool.query<{ return_to: string }>(
      'select return_to from login_attempts',
    );
    return rows.map((row) => row.return_to);
  }

  /** Every invitation link is past its expiry from now on. */
  async expireInvitations(): Promise<void> {
    await this.pool.query("update invitations set expires_at = now() - interval '1 minute'");
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
