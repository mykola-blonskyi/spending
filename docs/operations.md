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
| `NODE_ENV`               | `development`, `test` or `production`                                          |
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
