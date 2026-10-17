# Operations

## Local development

Requirements: Node 24 (`.nvmrc`), pnpm 11 (`corepack enable`), Docker.

```bash
pnpm install
pnpm db:up            # Postgres 18 on 127.0.0.1:55440 (databases spending and spending_test)
pnpm dev              # API on :3000, web on :5173 (proxies /api to the API)
```

Checks, identical to CI:

```bash
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test             # unit and component tests
pnpm test:integration # API against Postgres (TEST_DATABASE_URL)
pnpm test:e2e         # Playwright against the production build
pnpm build
pnpm openapi          # regenerate apps/web/src/data/openapi.json and api.gen.ts after API changes
```

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`. Its jobs are the
required status checks:

- `Lint, format, typecheck` (also fails if the OpenAPI document or client types are stale)
- `Unit and component tests`
- `API integration tests`
- `Playwright E2E`
- `Production build`
- `Docker stack smoke test`

### Branch protection (owner action)

The repository settings were not changed by this work. To require the checks:

1. Settings → Rules → Rulesets → New branch ruleset, target `main`.
2. Enable "Restrict deletions", "Block force pushes", "Require a pull request before merging".
3. Enable "Require status checks to pass", add the six job names above, and enable "Require
   branches to be up to date before merging".

### Actions spending (owner action)

The repository is public, so standard GitHub-hosted runners are free. To guarantee nothing is
ever billed (for example if the repository becomes private and exhausts the 2,000 free minutes):

1. github.com/settings/billing → Budgets and alerts → New budget.
2. Product-level budget → Actions → amount `0` → enable "Stop usage when budget limit is reached".

Workflows then stop instead of incurring charges. Never switch to larger runners.

## Configuration

The API reads its configuration from the environment and refuses to start when any value is
missing or invalid. `apps/api/.env.example` documents every variable with local defaults.

| Variable                 | Meaning                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| `NODE_ENV`               | `development`, `test` or `production` (default `production`)                   |
| `PORT`                   | API listen port (default 3000)                                                 |
| `DATABASE_URL`           | PostgreSQL connection string                                                   |
| `APP_ORIGIN`             | Public origin, e.g. `https://spending.blonskyi.dev`. https in production       |
| `OIDC_ISSUER`            | `https://login.blonskyi.dev`                                                   |
| `OIDC_CLIENT_ID`         | Client registered at the provider                                              |
| `OIDC_CLIENT_SECRET`     | Its secret (`client_secret_basic`)                                             |
| `SESSION_ENCRYPTION_KEY` | Base64 of 32 random bytes. Rotating it signs everyone out at the next re-check |
| `COOKIE_SECURE`          | Default `true`; must be `true` in production                                   |
| `SOURCE_COMMIT`          | Build commit shown by `/api/health` (default `unknown`); Coolify sets it       |

Register these URIs with the provider: redirect `${APP_ORIGIN}/api/v1/auth/callback` and
post-logout `${APP_ORIGIN}/signin`.

### Signing in locally

The fake provider stands in for `login.blonskyi.dev`. It offers one button per test user
(`FAKE_OIDC_USERS`, default Owner and Member) and accepts the client in `apps/api/.env.example`.

```bash
cp apps/api/.env.example apps/api/.env   # set NODE_ENV=test and a SESSION_ENCRYPTION_KEY
DATABASE_URL=postgres://spending:spending@127.0.0.1:55440/spending pnpm --filter @spending/api db:migrate
pnpm --filter @spending/api fake-oidc    # provider on :4400
pnpm dev                                 # open http://localhost:5173 and continue with Google
```

`pnpm dev` loads `apps/api/.env`. The API talks to a plain-http issuer only when `NODE_ENV=test`.

### End-to-end tests

`pnpm test:e2e` runs against the production build, so run `pnpm build` first. Playwright starts
three servers itself and stops them afterwards:

| Server       | Port | Started as                                                                              |
| ------------ | ---- | --------------------------------------------------------------------------------------- |
| fake OIDC    | 4410 | `node --import tsx test/fake-oidc/main.ts` with users ann and bob                       |
| API          | 3410 | `node e2e/support/start-api.ts`: rebuilds `E2E_DATABASE_URL`, then runs `apps/api/dist` |
| vite preview | 4173 | proxies `/api` to the API                                                               |

Set `E2E_PORT_OFFSET` (for example 100) to shift all three ports when another checkout runs E2E
at the same time; give each checkout its own `E2E_DATABASE_URL` too.

`E2E_DATABASE_URL` defaults to `spending_e2e` on the dev Postgres and is created when missing. The
script refuses any database whose name does not end in `_e2e`. Tests run on one worker, and each
starts from empty tables. Use the `test` export of `apps/web/e2e/fixtures.ts`: it provides
`signInAs('ann')` and `db` (direct access, e.g. `db.endSessions(email)` to simulate a revoked
session). Each test sends its own `X-Forwarded-For`, so the per-IP sign-in limit never couples tests.
`seedEntries(page, count)` (`e2e/support/seed.ts`) fills a history through the sync push API, as
another device would.

Runs side by side (several worktrees, or agents): `E2E_PORT_OFFSET=100` shifts all three ports,
`E2E_DATABASE_URL` names a separate `_e2e` database, and `E2E_WEB_DIST` previews a bundle built
elsewhere (`vite build --outDir <dir>`) instead of the shared `dist/`. `e2e/shots.spec.ts` is a
screenshot tool, not a check: it runs only with `SHOTS_DIR` set (and `SHOT_LAYOUTS` to narrow it).

## Production topology

```text
Cloudflare (proxied) → Traefik (Coolify) → web:8080 nginx ──/api/──► spending-api:3000 NestJS
                                                                        │
predeploy-backup → migrate → api → web          (start order)           ▼
backup (daily pg_dump) ──► spending-backups volume       Postgres 18 at 3p9qjnulllqn3bcjqokir0wq:5432
```

`docker-compose.yml` is the Coolify stack (ADR-004). Images: `deploy/api.Dockerfile` (also runs
`migrate`), `deploy/web.Dockerfile`, `deploy/backup.Dockerfile`. Only `web` has a domain. All
containers run as non-root users.

Every deploy runs `predeploy-backup` (a `pg_dump`), then `migrate`, then starts `api` and waits
for it to be healthy before `web`. Compose recreates both `web` and `api`, so the whole site is
unavailable while the backup and migration run, typically a few seconds. If the dump or a
migration fails, the deploy fails and the whole site stays down until a later deploy succeeds.
That is deliberate (fail-closed): new code never runs against an old schema, and nothing runs
without a fresh dump. Fix forward or revert and redeploy (see Rollback).

`SOURCE_COMMIT` is provided by Coolify (the commit it built) through the `.env` it attaches to
every service, and `/api/health` reports it as `version`, so the Deploy workflow can confirm the
running build is the commit it verified. Outside Coolify it is `unknown`.

Never reference `${SOURCE_COMMIT}` in `docker-compose.yml`. Coolify turns every variable the file
mentions into a stored user variable (with the `:-` default as its value), and a stored
`SOURCE_COMMIT` replaces the real commit on every deploy. If one appears under Environment
Variables, delete it.

### Real client IP

Traffic is Cloudflare → Traefik → nginx → API. Coolify's Traefik does not trust forwarded
headers, so it rewrites `X-Forwarded-For` to its own peer. That peer is a Cloudflare edge for
proxied traffic, or the client itself when someone reaches the VPS directly.

nginx (`deploy/nginx.conf`) recovers that peer from private-range proxies. It believes
`CF-Connecting-IP` only when the peer is in Cloudflare's published ranges
(`deploy/cloudflare-ips.conf`). A request that bypasses Cloudflare therefore cannot spoof its
address. nginx sends the result as the only `X-Forwarded-For` value to the API.

The API sets Express `trust proxy` to `1`: it trusts exactly one hop, the peer that connects to
it, and takes `req.ip` from the rightmost `X-Forwarded-For` entry, the one nginx wrote. The
per-IP `auth` and `sensitive` budgets key on it. Two other values were rejected:

- A list of private ranges (the earlier `loopback, linklocal, uniquelocal`) also walks past any
  private address a client prepends, and is no narrower: every container on the `coolify`
  network has such an address.
- The stack network's subnet. Docker assigns it when Coolify creates the network, so it is not
  known in advance and can change on recreate. When the subnet is wrong, `req.ip` becomes
  nginx's own address, every visitor shares one sign-in budget, and sign-in locks out
  site-wide.

Residual risk: the API is reachable on the shared `coolify` network (it needs it for Postgres).
Another container on that network can call `spending-api:3000` directly with a forged
`X-Forwarded-For`, and so evade the per-IP budgets. The per-user budgets still apply after
sign-in. This stack's containers drop `NET_RAW` (see Container hardening), so a compromised one
cannot ARP-spoof the plaintext nginx→API and API→Postgres hops; other stacks on that network
are outside this repository. Closing the gap fully needs nginx to prove itself to the API, for
example with a shared-secret header. That is not done.

Cloudflare occasionally changes its ranges. Refresh the file, review the diff, and redeploy:

```bash
{
  echo "# Cloudflare's published proxy ranges, as a geo map: an address in these ranges is a Cloudflare"
  echo "# edge, so its CF-Connecting-IP header names the real client."
  echo "# Fetched $(date -u +%Y-%m-%d) from https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6."
  echo '# Refresh: re-run the loop in docs/operations.md ("Real client IP"), review the diff, redeploy.'
  for u in ips-v4 ips-v6; do
    curl -fsS "https://www.cloudflare.com/$u" | tr -d '\r' | sed -e '/^$/d' -e 's/$/ 1;/'
  done
} > deploy/cloudflare-ips.conf
```

Local smoke test of the whole stack (throwaway Postgres, dummy secrets, web on
`127.0.0.1:18080`):

```bash
docker compose --env-file deploy/smoke.env -f docker-compose.yml \
  -f deploy/docker-compose.smoke.yml up -d --build --wait
APP_URL=http://127.0.0.1:18080 sh scripts/check-deploy.sh
docker compose --env-file deploy/smoke.env -f docker-compose.yml \
  -f deploy/docker-compose.smoke.yml down -v
```

### Container hardening

Every service in `docker-compose.yml` runs as a non-root user, drops all Linux capabilities
(`cap_drop: [ALL]`) and sets `no-new-privileges`. None needs a capability: nginx listens on
8080, node and the backup scripts only open outbound connections and write files their user
owns. Dropping `NET_RAW` in particular stops a compromised container from sniffing or
ARP-spoofing the plaintext hops on the shared network. The throwaway Postgres in
`deploy/docker-compose.smoke.yml` is left at Docker's defaults: its entrypoint starts as root
and needs `CHOWN`, `SETUID`, `SETGID`, `FOWNER` and `DAC_OVERRIDE`, and it never runs in
production.

Not done yet, each worth adding later:

- `read_only: true` with a `tmpfs` for `/tmp` on `web` and `spending-api` (nginx writes its pid
  and temp files to `/tmp`; the backup containers also write `/backups`).
- Base images pinned by digest instead of by tag, with a scheduled job to bump them.
- Memory limits per service.

## First-time production setup (owner checklist)

1. **Database role and database.** Generate the password with `openssl rand -hex 24` (hex
   needs no URL escaping), then:

   ```bash
   ssh blonskyi
   docker exec -i 3p9qjnulllqn3bcjqokir0wq psql -U postgres
   ```

   ```sql
   CREATE ROLE spending_app LOGIN PASSWORD '<generated>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
   CREATE DATABASE spending OWNER spending_app;
   REVOKE ALL ON DATABASE spending FROM PUBLIC;
   ```

   `DATABASE_URL` is `postgres://spending_app:<generated>@3p9qjnulllqn3bcjqokir0wq:5432/spending`.
   Use the container name, never the `postgres` alias, which other stacks on the shared network
   may also answer to.

2. **Secrets.** `openssl rand -base64 32` once for `SESSION_ENCRYPTION_KEY` and once for the
   OIDC client secret. Store them only in Coolify and your password manager.

3. **OIDC client on login.blonskyi.dev.** Run the login service's `register-client` command
   inside its container against the login database, as the login README documents, with:

   ```bash
   REGISTER_CLIENT_ID=spending REGISTER_CLIENT_NAME=Spending \
   REGISTER_CLIENT_SECRET=<oidc secret from step 2> \
   REGISTER_REDIRECT_URIS=https://spending.blonskyi.dev/api/v1/auth/callback \
   REGISTER_POST_LOGOUT_REDIRECT_URIS=https://spending.blonskyi.dev/signin \
   login register-client
   ```

4. **Hub.** Add the `spending` project in the hub so users can be granted access to it, then
   grant yourself.

5. **DNS.** Cloudflare: `spending.blonskyi.dev`, A record to the VPS, proxied (orange cloud).

6. **Coolify resource.** New resource → Docker Compose → this repository, branch `main`,
   compose file `docker-compose.yml`. Then:
   - Turn Coolify's Auto Deploy off. The Deploy workflow deploys automatically after CI passes;
     Coolify's own auto-deploy would skip that gate and deploy every merge twice.
   - Turn "Connect to Predefined Network" on.
   - Domain `https://spending.blonskyi.dev` on the `web` service, port 8080. No other service
     gets a domain.
   - Environment variables: `DATABASE_URL`, `APP_ORIGIN=https://spending.blonskyi.dev`,
     `OIDC_ISSUER=https://login.blonskyi.dev`, `OIDC_CLIENT_ID=spending`, `OIDC_CLIENT_SECRET`,
     `SESSION_ENCRYPTION_KEY`. Each is `${VAR:?}` in the compose file, so a missing one fails
     the deploy. `MIGRATION_DATABASE_URL` is optional until the roles are split
     (Database roles).

7. **Coolify API token.** Keys & Tokens → new token with only the `deploy` and `read`
   abilities. Do NOT grant `read:sensitive` while the repository is public: Actions logs are
   public and build logs can contain secrets. Copy the resource's deploy webhook URL from its
   Webhooks page.

8. **GitHub.** Settings → Environments → `production`, deployment branches limited to `main`.
   In that environment add secrets `COOLIFY_DEPLOY_WEBHOOK_URL` and `COOLIFY_DEPLOY_TOKEN`, and
   variable `APP_URL=https://spending.blonskyi.dev`. Required reviewers are free on a public
   repository but optional; green CI on `main` is already the gate.

9. Deploy once (next section) and sign in.

10. **Slow-query log.** The shared instance has `log_min_duration_statement = -1`, so a query
    that turns slow as data grows (or a stalled sync) goes unnoticed. As the superuser, once:

    ```sql
    ALTER DATABASE spending SET log_min_duration_statement = '500ms';
    ALTER DATABASE spending SET log_parameter_max_length = 0;
    ```

    The second line keeps bind parameters (amounts, notes) out of the log. Both apply only to
    this database, from the next connection on, so the restore steps set them again on the new
    database. Read the log with `docker logs 3p9qjnulllqn3bcjqokir0wq 2>&1 | grep 'duration:'`.
    Undo with `ALTER DATABASE spending RESET log_min_duration_statement;` and
    `ALTER DATABASE spending RESET log_parameter_max_length;`.

## Database roles

`spending_app` owns the database today and runs both the migrations and the app, so a SQL-level
compromise of the app could run DDL or `DROP` its tables. The split below gives the schema to a
`spending_owner` role that only `migrate` uses (`MIGRATION_DATABASE_URL`), and leaves
`spending_app` with data access only. Until it is done, `MIGRATION_DATABASE_URL` stays unset and
`migrate` uses `DATABASE_URL`, as before.

What each role needs, from the code:

- The API at runtime: `SELECT`, `INSERT`, `UPDATE`, `DELETE` on the tables, and `USAGE` on the
  `ledger_revision` sequence (column defaults and the stamp triggers call `nextval`). It runs no
  DDL, no `TRUNCATE` and no `setval`; the ledger lock is an advisory lock, which needs no
  privilege. The trigger functions run with the caller's rights and `EXECUTE` stays granted to
  `PUBLIC`.
- `pg_dump` in `backup` and `predeploy-backup`: `SELECT` on every table and sequence, including
  the `drizzle` schema, which it dumps too.
- Migrations: ownership of both schemas and every object in them. The migrator runs
  `CREATE SCHEMA IF NOT EXISTS drizzle` on every start, which fails without `CREATE` on the
  database even when no migration is pending. So once the roles are split, a deploy without
  `MIGRATION_DATABASE_URL` fails at `migrate`, and the site stays down until it is set.
- `deploy/after-restore.sql` calls `setval`, which needs `UPDATE` on the sequence, so it runs as
  the superuser (see Backups and restore).

Split the roles (owner, once). Do steps 1 to 3 without a deploy in between; the running app is
not affected.

1. Generate a password with `openssl rand -hex 24`, then open psql as the superuser on the
   `spending` database:

   ```bash
   ssh blonskyi
   docker exec -i 3p9qjnulllqn3bcjqokir0wq psql -U postgres -d spending
   ```

2. Paste this, with the password in place of `<generated>`:

   ```sql
   \set ON_ERROR_STOP on
   BEGIN;
   CREATE ROLE spending_owner LOGIN PASSWORD '<generated>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
   -- Everything spending_app owns here, and the spending database itself, moves to the owner.
   REASSIGN OWNED BY spending_app TO spending_owner;
   GRANT CONNECT ON DATABASE spending TO spending_app;
   GRANT USAGE ON SCHEMA public, drizzle TO spending_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO spending_app;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO spending_app;
   GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO spending_app;
   GRANT SELECT ON ALL SEQUENCES IN SCHEMA drizzle TO spending_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE spending_owner IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO spending_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE spending_owner IN SCHEMA public
     GRANT USAGE, SELECT ON SEQUENCES TO spending_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE spending_owner IN SCHEMA drizzle
     GRANT SELECT ON TABLES TO spending_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE spending_owner IN SCHEMA drizzle
     GRANT SELECT ON SEQUENCES TO spending_app;
   COMMIT;
   ```

   `REASSIGN OWNED` also hands over any other database `spending_app` owns (a leftover
   `spending_restore` or `spending_replaced_*`), but not the objects inside them. The default
   privileges make every table and sequence a later migration creates usable by `spending_app`.

3. Verify, in the same psql session. Both `CREATE` statements must fail with
   `permission denied`, the owner must be `spending_owner`, and the count must be 0:

   ```sql
   SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'spending';
   SELECT count(*) FROM pg_class
     WHERE relnamespace IN ('public'::regnamespace, 'drizzle'::regnamespace)
       AND pg_get_userbyid(relowner) = 'spending_app';
   SET ROLE spending_app;
   \set ON_ERROR_STOP off
   CREATE TABLE public.ddl_probe (id int);
   CREATE SCHEMA ddl_probe;
   RESET ROLE;
   ```

4. In Coolify, add `MIGRATION_DATABASE_URL` =
   `postgres://spending_owner:<generated>@3p9qjnulllqn3bcjqokir0wq:5432/spending` to the
   resource, then redeploy (Deploying). `DATABASE_URL` stays `spending_app`. Check that the
   `migrate` container exited 0, `/api/health/ready` answers, and that the next `backup` run
   logs `wrote daily-...`.

Roll back (owner): remove `MIGRATION_DATABASE_URL` from Coolify, then as the superuser:

```sql
\set ON_ERROR_STOP on
BEGIN;
REASSIGN OWNED BY spending_owner TO spending_app;
-- Nothing is owned by spending_owner any more; this drops its default privileges and grants.
DROP OWNED BY spending_owner;
COMMIT;
DROP ROLE spending_owner;
```

`DROP ROLE` fails with "objects in database ..." when `spending_owner` still owns objects
elsewhere, such as a scratch restore database: connect to each database it names
(`psql -U postgres -d <name>`), run the `BEGIN` ... `COMMIT` block there, then `DROP ROLE`
again. Redeploy afterwards.

The runbook was rehearsed on a throwaway local database: migrations up to 0010 as the app role,
then the split, migration 0011 applied as the owner, the app (sign-in, sync push, family
invitation, export, recurring generation, mutation pruning) run as `spending_app`, a table
created later by the owner used by the app, `pg_dump` and the restore below, and the rollback.

## Deploying

Automatic: every merge to `main` deploys once CI passes on it. The Deploy workflow starts from
the finished CI run (`workflow_run`), triggers Coolify for that exact commit, waits for the
deployment to finish (`scripts/coolify-deploy.sh`), then checks `/api/health/ready` and the
security headers through the public URL (`scripts/check-deploy.sh`). A red CI run deploys
nothing. When several merges land close together, the runs for older commits stand down (main
has moved) and only the newest commit deploys. Deploys are serialized.

By hand (redeploy, or after fixing a Coolify setting): Actions → Deploy → Run workflow, branch
`main`. A manual run re-runs CI for that commit first.

Coolify builds the head of `main`, not a given SHA: its deploy API takes only `uuid`, `tag` and
`force`, and pinning a commit would need a token with write access to the resource. The workflow
therefore stops right before the trigger if `main` has moved since that commit: an automatic
run stands down, a manual one fails ("re-run on the new head"). A push landing in the seconds between that check and Coolify's checkout would deploy
an unverified commit; the post-deploy check then waits until `/api/health` reports the dispatched
SHA as `version` and fails on a mismatch, so the window is detected, not prevented; the next
commit's run then deploys it properly. Roll back with a revert, which deploys like any merge.

Cloudflare bot protection may challenge requests from GitHub runners and fail the post-deploy
check. Add a WAF custom rule: Security → WAF → Custom rules, expression
`(http.host eq "spending.blonskyi.dev" and starts_with(http.request.uri.path, "/api/health"))`,
action Skip (all remaining custom rules, and Bot Fight Mode / Super Bot Fight Mode if offered).

Cloudflare's zone Browser Cache TTL rewrites `Cache-Control` on static files such as `/sw.js`
(seen as `max-age=14400`), which fails the post-deploy cache-header check. A Cache Rule keeps the
origin's headers for this host only: Caching → Cache Rules → Create rule, Hostname equals
`spending.blonskyi.dev`, Eligible for cache, Browser TTL "Respect origin TTL". Verify with
`curl -sI https://spending.blonskyi.dev/sw.js | grep -i cache-control` (expect `no-cache`).

## Rollback

- **Code.** Revert the commit on `main`; the revert deploys automatically once CI passes, so it is
  the only documented path. (Redeploying an old deployment from the Coolify UI skips the CI gate; keep it
  for emergencies.)
- **Schema.** Migrations are forward-only. Every migration must be backward-compatible with the
  previous release (expand, deploy, then contract in a later release), so rolling the code back
  never needs a down migration.
- **Data.** Never rolled back automatically. Restore a pre-migrate dump only by hand, after
  checking what data written since the dump would be lost.

## Backups and restore

- `predeploy-backup` writes `pre-migrate/pre-migrate-<UTC timestamp>.dump` before every deploy
  and keeps the newest 10.
- `backup` writes `daily/daily-<date>.dump` at 03:00 UTC (and on start if today's is missing),
  keeps 14 daily and 8 weekly (`weekly/weekly-<ISO week>.dump`).
- Dumps are `pg_dump --format=custom` (gzip-compressed), mode 600, in the `spending-backups`
  volume. The script logs only file names and sizes. The container turns unhealthy when no daily
  dump is younger than 26 hours.
- Each dump is checked with `pg_restore --list` before it is kept; a daily dump must also list
  the `transactions` table data. A corrupt, empty or wrong-database dump is
  discarded and the run fails: `predeploy-backup` stops the deploy, and for the daily dump the
  container turns unhealthy once the last good one is older than 26 hours. `DATABASE_URL` may
  carry `?sslmode=...` (passed as `PGSSLMODE`); any other query parameter is refused.
- The volume is on the VPS disk only unless the optional off-host copy is configured. When
  `BACKUP_OFFSITE_REMOTE` is set on the Coolify resource, the `backup` container also copies each
  daily dump there with rclone and touches `offsite.ok` in the volume. A failed copy fails the run
  after local pruning (logged, retried next day), and the container turns unhealthy when
  `offsite.ok` is older than 26 hours. Owner
  steps: create a private S3-compatible bucket (Backblaze B2, Cloudflare R2, ...) with a
  lifecycle rule that expires objects after about 30 days, create a key restricted to that
  bucket, then set `BACKUP_OFFSITE_REMOTE=:s3:<bucket>/spending`, `RCLONE_S3_PROVIDER`,
  `RCLONE_S3_ENDPOINT`, `RCLONE_S3_REGION` (if the provider needs it), `RCLONE_S3_ACCESS_KEY_ID`
  and `RCLONE_S3_SECRET_ACCESS_KEY`. Nothing is printed except file names. Off-host dumps are
  restored by downloading the file and following the restore steps below.
- Current target: the MinIO service on the same VPS, bucket `spending-backups` (private, objects
  expire after 30 days). The key `spending-backup` may list, read and write that bucket but not
  delete, so a compromised app cannot wipe the copies. The six variables are in
  `~/spending-backup-s3.env` on the VPS (mode 600); paste them into the Coolify resource. Two
  settings are required:
  - Turn on "Connect to Predefined Network" on the resource. The endpoint is
    `http://minio:9000` on the `coolify` network; `s3.blonskyi.dev` goes through Cloudflare,
    which breaks S3 request signatures and caps uploads at 100 MB.
  - Keep `no_check_bucket=true` in `BACKUP_OFFSITE_REMOTE`
    (`:s3,no_check_bucket=true:spending-backups/spending`); without it rclone tries to create
    the bucket and the restricted key gets 403.
- This copy survives a deleted `spending-backups` volume or `down -v`, not the loss of the VPS
  disk, because MinIO stores its data on the same disk. For disaster recovery, point the same
  variables at a provider on another machine.

Restore into a scratch database first, verify, then swap. On the VPS (`ssh blonskyi`); the
backup container name comes from `docker ps --format '{{.Names}}' | grep '^backup-'`:

```bash
BACKUP=<backup container name>
OWNER=spending_owner   # spending_app while the roles are not split (Database roles)
docker exec "$BACKUP" ls -l /backups/daily /backups/weekly /backups/pre-migrate

docker exec -i 3p9qjnulllqn3bcjqokir0wq psql -U postgres \
  -c "CREATE DATABASE spending_restore OWNER $OWNER;" \
  -c 'REVOKE ALL ON DATABASE spending_restore FROM PUBLIC;' \
  -c 'GRANT CONNECT ON DATABASE spending_restore TO spending_app;' \
  -c "ALTER DATABASE spending_restore SET log_min_duration_statement = '500ms';" \
  -c 'ALTER DATABASE spending_restore SET log_parameter_max_length = 0;'

# The superuser restores as $OWNER, so no password is typed and every object belongs to it.
docker exec "$BACKUP" cat /backups/daily/daily-YYYY-MM-DD.dump |
  docker exec -i 3p9qjnulllqn3bcjqokir0wq pg_restore -U postgres --dbname=spending_restore \
    --no-owner --role="$OWNER" --exit-on-error

docker exec -i 3p9qjnulllqn3bcjqokir0wq psql -U postgres -d spending_restore \
  -c '\dt' -c 'SELECT count(*) FROM drizzle.__drizzle_migrations;' \
  -c 'SELECT count(*) FROM transactions;'

# Required. Moves ledger_revision past every device cursor and sets a new sync epoch, so every
# device drops what it cached and pulls the restored data from 0 (BR-35). It calls setval, which
# spending_app may not, so the superuser runs it.
docker exec "$BACKUP" cat /usr/local/share/spending/after-restore.sql |
  docker exec -i 3p9qjnulllqn3bcjqokir0wq psql -U postgres -d spending_restore -v ON_ERROR_STOP=1
```

With split roles, also run the `GRANT` and `ALTER DEFAULT PRIVILEGES` statements of Database
roles step 2 in `spending_restore` (`psql -U postgres -d spending_restore`). A dump taken before
the split carries none, and default privileges belong to each database. They are idempotent.

`after-restore.sql` lives in `deploy/` and ships in the backup image. A dump older than migration
0009 has no `sync_epoch` table; the script skips the epoch and the redeploy's migration creates a
fresh one.

If the scratch copy is right, stop the resource in Coolify, then swap:

```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'spending';
ALTER DATABASE spending RENAME TO spending_replaced_YYYYMMDD;
ALTER DATABASE spending_restore RENAME TO spending;
```

Redeploy the commit whose migrations match the dump. Drop `spending_replaced_*` only once the
restored database has been in use for a while.

## Monitoring

- Container logs and status: the Coolify resource page (`api` logs are JSON lines).
- Health: `/api/health` (process up) and `/api/health/ready` (database reachable), also used by
  the container health checks and the Deploy workflow.
- Backups: the `backup` container's health and log lines.
- The web access log redacts invitation tokens, `returnTo` values and the OIDC callback query
  (`code`, `state`). The nginx error log does not: when the API is unreachable it names the
  request line, so a failed `/invite/<token>` or callback request shows its secrets there. Accepted
  for debuggability; treat web container logs as sensitive.
- No third-party telemetry or error reporting.

## Security headers

Static, in `deploy/security-headers.conf`, included by `deploy/nginx.conf` in the server block
and in every location that sets its own `Cache-Control` (nginx drops inherited `add_header`
directives otherwise). The CSP allows no inline scripts; `style-src` includes `'unsafe-inline'` because sonner and
Radix inject styles (ADR-011). Caching:
`/assets/*` is immutable for a year, `/api/` is `no-store`, everything else (including
`index.html`, `sw.js`, `manifest.webmanifest`) is `no-cache`. Source maps are
not shipped and `*.map` returns 404.
