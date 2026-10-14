# Architecture

## Overview

Spending is a personal expense tracker with an optional family workspace. It is an installable
PWA that works offline and syncs when it reconnects. It runs entirely on the owner's VPS. Sign-in
goes through the shared OIDC provider `login.blonskyi.dev` (Google behind it).

```text
browser (PWA, IndexedDB, sync queue)
   │  same origin: https://spending.blonskyi.dev
   ▼
Cloudflare → Traefik (Coolify) → web: nginx (static build, CSP, /api proxy)
                                      │ private network
                                      ▼
                                 api: NestJS ──► PostgreSQL 18 (shared host, own DB and role)
                                      │
                                      ├──► login.blonskyi.dev (OIDC, confidential client)
                                      └──► ECB reference rates (daily XML)
```

## Repository

```text
apps/api     NestJS modular monolith (ADR-001)
apps/web     React + Vite SPA/PWA
docs/        architecture, decisions, operations
knowledge/   domain model, business rules, glossary
deploy/      compose stack, nginx config, backup scripts
```

## Backend modules (`apps/api/src`)

| Module       | Owns                                                                    |
| ------------ | ----------------------------------------------------------------------- |
| `database`   | Drizzle schema, migrations, connection, transaction helper              |
| `common`     | config, actor context, error codes, rate limits, HTTP middleware        |
| `auth`       | OIDC login/logout, sessions, grant re-check, session and CSRF guards    |
| `users`      | profile and preferences, export, account deletion                       |
| `workspaces` | personal/family workspaces, memberships, invitations, the access policy |
| `ledger`     | accounts, categories, transaction reads and writes, FX conversion       |
| `sync`       | push (idempotent mutations), pull (revision cursor), conflicts          |
| `budgets`    | monthly category limits and progress                                    |
| `recurring`  | recurring rules and the idempotent generator job                        |
| `imports`    | CSV batches, dedupe, categorization, review queue, undo                 |
| `analytics`  | totals, time series, category breakdown, period comparison              |

`workspaces` exports `AccessPolicy`, which every other module calls before touching
workspace-scoped data (BR-1, BR-2). Business logic that needs no I/O (money, schedules, dedupe
keys, categorization, CSV row parsing, conflict detection) is written as pure functions with unit
tests. Services are thin shells over them.

## Frontend layers (`apps/web/src`)

| Layer        | May import                                           | Contents                                                             |
| ------------ | ---------------------------------------------------- | -------------------------------------------------------------------- |
| `app`        | everything (public entries only)                     | router, layouts, providers, screen composition                       |
| `features/*` | `data`, `shared`, `i18n`, other features' `index.ts` | feature UI, hooks, tests                                             |
| `data`       | `shared`                                             | fetch client, OpenAPI types, query options, local store, sync engine |
| `i18n`       | `shared`                                             | `use-intl` setup and message catalogs                                |
| `shared`     | nothing above it                                     | ui (shadcn), formatting, theme, shell primitives                     |

Aliases `@app/*`, `@data/*`, `@features/*`, `@shared/*`, `@i18n/*` are identical in `tsconfig`
and Vite. ESLint (`eslint-plugin-boundaries`) enforces the table.

`shared` cannot read the message catalogs, so its components take their words from
`SharedLocaleProvider` (`@shared/lib/locale-context`). The app fills it from the active `use-intl`
catalog, so shared components stay translated without importing `i18n`. API failures reach the UI
as `ApiError` with a stable `code`, and screens show `errors.<code>` from the catalog.

## Data flow

- **Reads.** Accounts, categories and transactions are pulled into IndexedDB (partitioned per
  user) and read locally. Everything else comes from REST via TanStack Query.
- **Transaction writes.** They go to the local store and the mutation queue, then
  `POST /api/v1/sync/push` (ADR-006). Results update the local rows: applied, conflict or
  rejected.
- **Conflicts.** The server keeps its row and records the client's version (BR-19). The client
  shows both and lets the user pick or merge.

## Security

- Authentication runs only through the shared OIDC provider. The API is a confidential client
  with PKCE (ADR-003).
- Authorization: the session gives the actor, and `AccessPolicy` checks membership for every
  workspace-scoped operation.
- Sessions are opaque and stored as hashes. Cookies are `__Host-`, HttpOnly, Secure and
  SameSite=Lax. CSRF uses a synchronizer header plus an Origin check. CORS is off because the
  app is same-origin. Rate limits apply to auth, invitations, imports and sync.
- Secrets live only in Coolify's environment panel. Logs carry request ID, route, status and
  duration only. Never bodies, amounts, notes or tokens.
- CSP and security headers are static in nginx (`deploy/security-headers.conf`): scripts are
  same-origin only; styles allow `'unsafe-inline'` (ADR-011).

## API errors

Every error is `{ error: { code, message, details? } }` with a stable `code` from
`apps/api/src/common/errors.ts`, which the web app localizes. Codes outside the generic HTTP set:
`SESSION_REVOKED`, `CSRF_FAILED`, `CONFIRMATION_MISMATCH` (400), `FAMILY_EXISTS` (409),
`OWNER_CANNOT_LEAVE` (409), `INVITATION_INVALID` (410). A workspace the actor does not belong to
is always `NOT_FOUND`, never `FORBIDDEN`.

## Observability

Structured JSON logs to stdout (collected by Docker and Coolify), `/api/health` for liveness and
`/api/health/ready` for DB readiness. No third-party telemetry.
