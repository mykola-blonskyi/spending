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

### Branch protection (owner action)

The repository settings were not changed by this work. To require the checks:

1. Settings → Rules → Rulesets → New branch ruleset, target `main`.
2. Enable "Restrict deletions", "Block force pushes", "Require a pull request before merging".
3. Enable "Require status checks to pass", add the five job names above, and enable "Require
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

Register these URIs with the provider: redirect `${APP_ORIGIN}/api/v1/auth/callback` and
post-logout `${APP_ORIGIN}/signin`.

For local sign-in without the real provider, run `pnpm --filter @spending/api fake-oidc` (port
4400). It offers one button per test user, configured with `FAKE_OIDC_USERS`,
`FAKE_OIDC_CLIENT_ID`, `FAKE_OIDC_CLIENT_SECRET` and `FAKE_OIDC_APP_ORIGIN`. The API talks to a
plain-http issuer only when `NODE_ENV=test`, so run it that way against the fake provider.

## Production topology

```text
Cloudflare (proxied) → Traefik (Coolify) → web:8080 nginx ──/api/──► api:3000 NestJS
                                                                        │
predeploy-backup → migrate → api → web          (start order)           ▼
backup (daily pg_dump) ──► spending-backups volume       Postgres 18 at 3p9qjnulllqn3bcjqokir0wq:5432
```

`docker-compose.yml` is the Coolify stack (ADR-004). Images: `deploy/api.Dockerfile` (also runs
`migrate`), `deploy/web.Dockerfile`, `deploy/backup.Dockerfile`. Only `web` has a domain. All
containers run as non-root users.

Every deploy runs `predeploy-backup` (a `pg_dump`), then `migrate`, then starts `api` and waits
for it to be healthy before `web`. If the dump or a migration fails, the deploy fails and `api`
stays stopped: Compose has already removed the old `api` container by then, so `/api` answers
502 until a deploy succeeds. That is deliberate; new code never runs against an old schema, and
nothing runs without a fresh dump. Fix forward or redeploy the previous commit (see Rollback).

Local smoke test of the whole stack (throwaway Postgres, dummy secrets, web on
`127.0.0.1:18080`):

```bash
docker compose --env-file deploy/smoke.env -f docker-compose.yml \
  -f deploy/docker-compose.smoke.yml up -d --build --wait
APP_URL=http://127.0.0.1:18080 sh scripts/check-deploy.sh
docker compose --env-file deploy/smoke.env -f docker-compose.yml \
  -f deploy/docker-compose.smoke.yml down -v
```

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
   - Turn auto-deploy on push off. Only the Deploy workflow deploys.
   - Turn "Connect to Predefined Network" on.
   - Domain `https://spending.blonskyi.dev` on the `web` service, port 8080. No other service
     gets a domain.
   - Environment variables: `DATABASE_URL`, `APP_ORIGIN=https://spending.blonskyi.dev`,
     `OIDC_ISSUER=https://login.blonskyi.dev`, `OIDC_CLIENT_ID=spending`, `OIDC_CLIENT_SECRET`,
     `SESSION_ENCRYPTION_KEY`. Each is `${VAR:?}` in the compose file, so a missing one fails
     the deploy.

7. **Coolify API token.** Keys & Tokens → new token with only the `deploy` and `read`
   abilities (add `read:sensitive` only if you want build logs printed on failure). Copy the
   resource's deploy webhook URL from its Webhooks page.

8. **GitHub.** Settings → Environments → `production`, deployment branches limited to `main`.
   In that environment add secrets `COOLIFY_DEPLOY_WEBHOOK_URL` and `COOLIFY_DEPLOY_TOKEN`, and
   variable `APP_URL=https://spending.blonskyi.dev`. Required reviewers are free on a public
   repository but optional; the manual dispatch is already the gate.

9. Deploy once (next section) and sign in.

## Deploying

Actions → Deploy → Run workflow, branch `main`. The workflow re-runs CI for that commit, triggers
Coolify, waits for the deployment to finish (`scripts/coolify-deploy.sh`), then checks
`/api/health/ready` and the security headers through the public URL
(`scripts/check-deploy.sh`). Deploys are serialized; a second dispatch waits for the first.

## Rollback

- **Code.** Revert the commit on `main` and dispatch Deploy, or redeploy the previous
  deployment from the Coolify UI.
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
- The volume is on the VPS disk only. Copy dumps off the host for disaster recovery.

Restore into a scratch database first, verify, then swap. On the VPS (`ssh blonskyi`); the
backup container name comes from `docker ps --format '{{.Names}}' | grep '^backup-'`:

```bash
BACKUP=<backup container name>
docker exec "$BACKUP" ls -l /backups/daily /backups/weekly /backups/pre-migrate

docker exec -i 3p9qjnulllqn3bcjqokir0wq psql -U postgres \
  -c 'CREATE DATABASE spending_restore OWNER spending_app;' \
  -c 'REVOKE ALL ON DATABASE spending_restore FROM PUBLIC;'

# DATABASE_URL is expanded inside the container, so it never reaches your shell history.
docker exec "$BACKUP" sh -c 'pg_restore --dbname="${DATABASE_URL%/*}/spending_restore" \
  --no-owner --exit-on-error /backups/daily/daily-YYYY-MM-DD.dump'

docker exec -i 3p9qjnulllqn3bcjqokir0wq psql -U postgres -d spending_restore \
  -c '\dt' -c 'SELECT count(*) FROM drizzle.__drizzle_migrations;' \
  -c 'SELECT count(*) FROM transactions;'
```

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
- No third-party telemetry or error reporting.

## Security headers

Static, in `deploy/security-headers.conf`, included by `deploy/nginx.conf` in the server block
and in every location that sets its own `Cache-Control` (nginx drops inherited `add_header`
directives otherwise). The CSP allows no inline scripts or styles; `style-src-attr
'unsafe-inline'` only covers the `style=""` attributes Radix sets for positioning. Caching:
`/assets/*` is immutable for a year, `/api/` is `no-store`, everything else (including
`index.html`, `sw.js`, `registerSW.js`, `manifest.webmanifest`) is `no-cache`. Source maps are
not shipped and `*.map` returns 404.
