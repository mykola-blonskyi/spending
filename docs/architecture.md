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
as `ApiError` with a stable `code`, and screens show `errors.<code>` from the catalog; `data`
components (`QueryUnavailable`, `useRefetchErrorToast`) read it through `strings.apiError`.

**Layouts and palettes.** The profile stores a `layout` and a `palette`. `app/layouts/registry`
maps each layout to a shell from `shared/shell` (all take the same `ShellProps`) and to its
dashboard, history, entry and detail screens; a missing screen falls back to the calm version,
and a missing `detail` (`/transactions/:id`) falls back to the layout's entry screen, which
edits by `:id`. Palettes are `[data-palette]` token sets in `shared/styles.css` applied on
`<html>` by `shared/theme` (and by `public/theme-init.js` before first paint); a unit test
checks their contrast.

**Transactions feature** (`features/transactions`). Logic lives once, in pure models
(`history-model.ts`: filters to query, rows, day grouping with row positions, per-currency
totals; `form-model.ts`: validation, the keypad reducer) and hooks (`useHistory`,
`useEntryForm`, `useTransactionDetail`). `blocks/` holds the building blocks every layout
composes (`HistoryList` is the only user of TanStack Virtual and virtualizes a flat list of day
headers and rows, scrolling the window or its own pane; `FilterSheet`, `HistoryStatus`, the
entry fields, `MasterDetail`, `EntryDetail`). `layouts/<layout>-{history,entry}.tsx` are
presentation only: an ESLint rule bans `@data/*` and `@tanstack/*` there. `layouts/screens.ts`
is the per-layout table the registry reads. Split and hybrid register their master-detail
history for both `history` and `detail`, so selecting a row keeps the list mounted.

**Dashboard feature** (`features/dashboard`). Same shape as transactions: `dashboard-model.ts`
holds the period math (calendar month, quarter, year or a custom range, and stepping) and pairs
each category with its previous-period amount; `useDashboard` owns the period and scope and reads
`/analytics/summary` and `/budgets` (budgets of the chosen month, otherwise this month), refetching
both after a sync (`useRefreshOnSync`). `blocks/` are self-titled sections (totals, trend,
categories, budgets via `BudgetProgress`, unconverted amounts); `layouts/<layout>-dashboard.tsx`
only arrange them, under the same ESLint rule, and hybrid uses the bento one. Charts are plain SVG
in theme tokens; the trend has a table under "Show as a table" and category bars carry their
figures as text.

**Ledger feature** (`features/ledger`). Accounts and categories screens write through REST
(`data/ledger.ts`) and then call `useRefreshLocalData()` (a push and pull), so the local store
stays the only inbound path and every picker updates from it. `categoryView` localizes a default
category by `systemKey` while its stored name still equals the English default, and maps the
stored lucide icon name to a curated icon set (`category-icons.ts`).

## Data flow

- **Reads.** Accounts, categories and transactions are pulled into IndexedDB (partitioned per
  user) and read locally. Everything else comes from REST via TanStack Query.
- **Transaction writes.** They go to the local store and the mutation queue, then
  `POST /api/v1/sync/push` (ADR-006). Results update the local rows: applied, conflict or
  rejected.
- **Local store** (`data/sync`). One IndexedDB database per user (`spending-<userId>`), listed in
  the device registry `localStorage['spending.localDatabases']`. Each transaction record keeps the
  last server row and, while a change is pending, the optimistic local row; readers count one of
  them, never both. A local write updates the record and the mutation queue in one IndexedDB
  transaction. Pull and push results are applied by pure reducers (`pull.ts`, `push.ts`), and
  the flusher (`engine.ts`) pushes up to 200 queued mutations in order, then pulls until
  `hasMore` is false.
- **Tabs.** Every commit re-reads the database inside its own IndexedDB transaction, so tabs never
  build on a stale copy. After a commit the store posts on the `BroadcastChannel`
  `spending-sync:<userId>`, and other tabs re-read. Any tab may flush, but each flush holds the Web
  Lock of the same name, so flushes never overlap. Without Web Locks, flushes run uncoordinated;
  the server applies each mutation ID once, so an overlapping push is harmless.
- **Flush triggers.** App start, the `online` event, becoming visible, 500 ms after a local
  write, and a 60 s heartbeat while visible and online. Transport errors and 5xx retry with
  backoff doubling from 1 s to 5 min, each wait drawn from its upper half. Offline, nothing is
  pushed. A push that left but got no answer (network error, 5xx) leaves its mutations
  `retrying`: the server may hold their results, so they are replayed unchanged and later edits
  queue behind them. A push that changed nothing (failed before the request left, or a 4xx such as 429) leaves them `queued`, still open to coalescing. A mutation that cannot be serialized
  fails on its own (`INTERNAL`) instead of stalling the queue.
- **Offline start.** The service worker (`vite-plugin-pwa`, Workbox `generateSW`) precaches the
  shell with an `index.html` navigation fallback; `/api/*` is on the navigation denylist and
  has no runtime caching. The last signed-in user is kept in `localStorage['spending.lastUser']`
  so an offline start opens their local data; it is removed on sign-out and when the session
  ends. A page started offline fetches the CSRF token before its first write (`client.ts`).
- **Status badge.** "Syncing" shows only after 300 ms and "synced" stays at least 600 ms, so a
  quick sync never flickers. The badge is a polite live region.
- **Conflicts.** The server keeps its row and records the client's version (BR-19). The client
  shows both and lets the user pick or merge.

## Sync protocol

Transactions change only through `POST /api/v1/sync/push` (ADR-006). Accounts and categories are
edited through REST and arrive through pull like transactions.

- **Push.** `{ mutations: [...] }`, 1 to 200, applied in order, each in its own ledger transaction.
  A mutation is `transaction.upsert` (`baseVersion` is the version the client edited, or null for a
  new row) or `transaction.delete` (`baseVersion` required). Each result is `applied` (with the
  fresh row), `conflict` (with `conflictId` and the server row) or `rejected` (with a stable code:
  `NOT_FOUND`, `FORBIDDEN`, `INVALID_ACCOUNT`, `INVALID_CATEGORY`, `REVIEW_REQUIRED`,
  `MUTATION_ID_REUSED`). Rate limit: 120 pushes per minute per user.
- **Idempotency.** Every result is stored under its `mutationId` (BR-18). A replay returns the
  stored status with a fresh view of the row. A `mutationId` already used by another user is
  rejected.
- **Conflicts.** An upsert whose `baseVersion` is stale or null on an existing row, or a stale
  delete, leaves the server row alone. If the intended fields already equal the server row it is
  `applied`. Otherwise the actor's open conflict for that row is created or refreshed (BR-19).
  `POST /sync/conflicts/:id/resolve` with `server`, `local` or `merged` (plus `transaction`)
  writes the chosen version against the current version and closes the conflict. Resolving again
  returns the current state without writing.
- **Pull.** `GET /sync/pull?cursor=&limit=` (limit 1 to 1000, default 500) reads one
  repeatable-read snapshot. It returns the actor's workspaces, then accounts, categories and
  transactions (tombstones as `{ id, workspaceId, deletedAt, revision }`) with `revision > cursor`,
  and all open conflicts. Accounts, categories, transactions and `sync_tombstones` share one
  revision sequence, so each is read with `limit + 1` rows. If any overflows, the page stops at
  the smallest `limit`-th revision among the overflowing sources, and `hasMore` is true. The
  returned `cursor` is the page's last revision (the input cursor when nothing changed).
  Pending-review rows are included; the client hides them.
- **Moves.** When an author moves a row to their other workspace, a `sync_tombstones` row for the
  workspace it left is written at the move's revision, and other users' open conflicts on it are
  dropped. Members of that workspace pull it once as a tombstone in `transactions`. Later edits
  of the row touch only `transactions`, so they never reach the old workspace (BR-2). A tombstone
  is skipped for a viewer who can see the row live again. Family deletion writes none, because
  the workspace and its tombstones are deleted with it.
- **Client duties.** Drop local rows of workspaces missing from `workspaces` (BR-17). When a new
  workspace id appears (the user joined a family), reset the cursor to 0, because that
  workspace's rows predate the cursor.
- **Account references (BR-3).** A viewer who cannot see a row's account receives
  `accountId: null`. Sending that null back in an upsert keeps the author's account. Only the
  author may choose an account from their own personal workspace.

## Budgets

`GET /budgets?workspaceId=&month=YYYY-MM` lists the budgets of every visible workspace (or one),
with progress for that month or the current month in the actor's timezone. `PUT /budgets` upserts
the limit of one expense category, and `DELETE /budgets/:id` removes it. The month range,
thresholds and progress fold are pure (`budgets/progress.ts`); one grouped query sums expenses
per budget and currency.

## Recurring rules

`GET|POST /recurring-rules`, `PATCH|DELETE /recurring-rules/:id` (`paused` in the PATCH body
pauses or resumes). The schedule (`recurring/schedule.ts`) is pure and works on calendar dates:
monthly and yearly rules keep `startsOn`'s day, clamped to shorter months. `RecurringService.runDue`
runs 10 s after startup and every 15 minutes (off when `NODE_ENV=test`). Each due rule commits in
its own `ledgerTransaction`, re-reads its row `for update`, inserts every occurrence up to today in
the rule's timezone with `ON CONFLICT (recurring_rule_id, recurring_occurrence) DO NOTHING`, and
advances `nextOccurrence` (null after `endsOn`). Create and edit generate due occurrences at once.

## Analytics

`GET /analytics/summary?from=&to=&scope=personal|family|all&compare=previous|none` (defaults
`all` and `previous`, at most 3660 days). One grouped query per period sums confirmed, live rows
of the scoped workspaces by day, kind, category and currency; pure folds (`analytics/summary.ts`)
build the totals, the unconverted list, the category breakdown (shares per kind, four decimals,
largest remainder so they sum to 1) and a zero-filled series by day (up to 31 days), ISO week (up
to 92) or month. Buckets are named by their first day inside the period. `previous` covers the
previous calendar month or year for a whole-month or whole-year period, else the equal-length
period just before, with deltas (current minus previous). Budget progress comes from `/budgets`.

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
`OWNER_CANNOT_LEAVE` (409), `NAME_TAKEN` (409), `REVIEW_REQUIRED` (409), `MUTATION_ID_REUSED`
(409), `INVITATION_INVALID` (410), `INVALID_ACCOUNT` (422), `INVALID_CATEGORY` (422). Sync push
reports rejections per mutation with the same codes instead of an HTTP error. A workspace the actor does not belong to
is always `NOT_FOUND`, never `FORBIDDEN`.

## FX rates

`ledger/fx` fetches the ECB daily feed 10 s after startup and every 6 hours, with a 10 s timeout.
It also fetches the 90-day history when the newest stored rate is more than 4 days old, so days
missed while the API or the ECB was down are recovered. When an unconverted non-EUR row predates
every stored rate, it loads the full history as well (ADR-007). Each feed is fetched on its own:
a failed or invalid feed is logged and dropped whole, and the others still apply. After each
refresh, transactions without a rate are converted, and rows converted with an earlier day's
rate move to a closer one. Only derived columns change, so `version` stays
and no offline edit turns into a conflict. The rate source is
an injectable `FxRateSource`, and the schedule is off when `NODE_ENV=test`.

## Observability

Structured JSON logs to stdout (collected by Docker and Coolify), `/api/health` for liveness and
`/api/health/ready` for DB readiness. No third-party telemetry.
