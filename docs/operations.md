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
