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
| `APP_VERSION`            | Optional build commit shown by `/api/health` (default `unknown`)               |

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
| fake OIDC    | 4410 | `node --import tsx test/fake-oidc/main.ts` with user ann                                |
| API          | 3410 | `node e2e/support/start-api.ts`: rebuilds `E2E_DATABASE_URL`, then runs `apps/api/dist` |
| vite preview | 4173 | proxies `/api` to the API                                                               |

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

`SOURCE_COMMIT` is provided by Coolify (the commit it built). Compose passes it to the API as
`APP_VERSION`, and `/api/health` reports it as `version`, so the Deploy workflow can confirm the
running build is the commit it verified. Outside Coolify it is `unknown`.

### Real client IP

Traffic is Cloudflare → Traefik → nginx → API. Coolify's Traefik does not trust forwarded
headers, so it rewrites `X-Forwarded-For` to its own peer. That peer is a Cloudflare edge for
proxied traffic, or the client itself when someone reaches the VPS directly.

nginx (`deploy/nginx.conf`) recovers that peer from private-range proxies. It believes
`CF-Connecting-IP` only when the peer is in Cloudflare's published ranges
(`deploy/cloudflare-ips.conf`). A request that bypasses Cloudflare therefore cannot spoof its
address. nginx sends the result as the only `X-Forwarded-For` value to the API, which trusts
only private ranges, so rate limits key on the real client.

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
   abilities. Do NOT grant `read:sensitive` while the repository is public: Actions logs are
   public and build logs can contain secrets. Copy the resource's deploy webhook URL from its
   Webhooks page.

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

Coolify builds the head of `main`, not a given SHA, so the workflow fails right before the
trigger if `main` has moved since dispatch ("re-run on the new head"). After the deploy, the
check waits until `/api/health` reports the dispatched SHA as `version`.

Cloudflare bot protection may challenge requests from GitHub runners and fail the post-deploy
check. Add a WAF custom rule: Security → WAF → Custom rules, expression
`(http.host eq "spending.blonskyi.dev" and starts_with(http.request.uri.path, "/api/health"))`,
action Skip (all remaining custom rules, and Bot Fight Mode / Super Bot Fight Mode if offered).

## Rollback

- **Code.** Revert the commit on `main` and dispatch Deploy. This re-runs CI, so it is the only
  documented path. (Redeploying an old deployment from the Coolify UI skips the CI gate; keep it
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
directives otherwise). The CSP allows no inline scripts; `style-src` includes `'unsafe-inline'` because sonner and
Radix inject styles (ADR-011). Caching:
`/assets/*` is immutable for a year, `/api/` is `no-store`, everything else (including
`index.html`, `sw.js`, `registerSW.js`, `manifest.webmanifest`) is `no-cache`. Source maps are
not shipped and `*.map` returns 404.
