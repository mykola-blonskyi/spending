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
deploy/      Docker images, nginx config, backup script
```

## Backend modules (`apps/api/src`)

| Module        | Owns                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| `database`    | Drizzle schema, migrations, connection, transaction helper              |
| `common`      | config, actor context, error codes, rate limits, HTTP middleware        |
| `auth`        | OIDC login/logout, sessions, grant re-check, session and CSRF guards    |
| `users`       | profile and preferences                                                 |
| `data-rights` | JSON export (CSV built in the web client), account deletion             |
| `workspaces`  | personal/family workspaces, memberships, invitations, the access policy |
| `ledger`      | accounts, categories, transaction reads and writes, FX conversion       |
| `sync`        | push (idempotent mutations), pull (revision cursor), conflicts          |
| `budgets`     | monthly category limits and progress                                    |
| `recurring`   | recurring rules and the idempotent generator job                        |
| `imports`     | statement batches, dedupe, categorization, review queue, undo           |
| `analytics`   | totals, time series, category breakdown, period comparison              |

`workspaces` exports `AccessPolicy`, which every other module calls before touching
workspace-scoped data (BR-1, BR-2). Business logic that needs no I/O (money, schedules, dedupe
keys, categorization, CSV row parsing, conflict detection) is written as pure functions with unit
tests. Services are thin shells over them. The ledger invariants (BR-3, BR-4, BR-37) live in
`ledger/rules.ts` with the one account and category lookup they need; sync, recurring and the
import review all check through it.

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
dashboard, history and entry screens, which every layout defines, and an optional detail screen.
A missing `detail` (`/transactions/:id`) falls back to the layout's entry screen, which
edits by `:id`. Palettes are `[data-palette]` token sets in `shared/styles.css` applied on
`<html>` by `shared/theme` (and by `public/theme-init.js` before first paint); a unit test
checks their contrast.

**Transactions feature** (`features/transactions`). Logic lives once, in pure models
(`history-model.ts`: filters to query, rows, day grouping with row positions, per-currency
totals, the history table's columns and rows; `form-model.ts`: validation, the keypad reducer)
and hooks (`useHistory`, `useEntryForm`, `useTransactionDetail`). `blocks/` holds the building
blocks every layout composes (`VirtualList` is the only user of TanStack Virtual, scrolling the
window or its own pane; `HistoryList` virtualizes a flat list of day headers and rows through it;
`FilterSheet`, `HistoryStatus`, the entry fields, `MasterDetail`, `EntryDetail`). Where the list
itself is at least 600 px wide (measured with `ResizeObserver`), `HistoryList` puts a rows /
table switch above it, so every layout that has the room gets it; phones and the card stack's
narrow column keep the rows, and the stored choice stays for a wider layout. The choice and the
table's sort are kept per device in `localStorage` as one object (`spending.history`,
`{view, sort}`, read and written in try/catch and validated on read, so the page works without
storage and an unknown value falls back to the default). The table (`HistoryTable`) is one block
in the layout's theme tokens: flat, the whole history on the same virtualizer, but always in
its own scroll box (TanStack's element virtualizer, never the window one) with a sticky header
row, so search, filters and totals stay in view. In split that box fills the pane; in the layouts
whose page scrolls it fills the viewport below the controls (`max-height` from the box's
measured page top, at least 20rem), since those shells are not viewport-high flex columns. The
rows view keeps scrolling with the page. Its columns are date, description, category, account,
amount, who (family members only) and sync. A transfer
is one row (BR-37), or its side under an account filter. Each row is a link to what the layout
opens for an entry; the table uses `role="table"` with `aria-rowcount` and `aria-rowindex`.
The Date, Category, Account and Amount headers are sort buttons (`aria-sort` on the active one).
`sortTableRows` orders the rows from a table of sort keys: date newest first by default; amount
by the absolute EUR amount the totals use (BR-14), entries without one last in both directions;
category and account by the shown name with `Intl.Collator` in the interface language, with
Uncategorized and then transfers, or rows without an account, last in both directions (a
transfer's account is its route, "Card → Savings"). Ties keep the
newest-first order, and a new sort starts the box at the top. The rows view keeps its day
order.
Split and hybrid decide from the whole master-detail width less the 400 px entry pane (not from
the list column, which widens once the table is shown) and then widen the list beside the pane. `layouts/<layout>-{history,entry}.tsx` are
presentation only: an ESLint rule bans `@data/*` and `@tanstack/*` there. `layouts/screens.ts`
is the per-layout table the registry reads. Split and hybrid register their master-detail
history for both `history` and `detail`, so selecting a row keeps the list mounted.

**Dashboard feature** (`features/dashboard`). Same shape as transactions: `dashboard-model.ts`
holds the period math (calendar month, quarter, year or a custom range, and stepping) and pairs
each category with its previous-period amount; `useDashboard` owns the period and scope and reads
`/analytics/summary` and `/budgets` (budgets of the chosen month, otherwise this month), refetching
both after the first completed sync and each one that moved the cursor (`useRefreshOnSync`). `blocks/` are self-titled sections (totals: income, expenses and period net; trend,
categories, budgets via `BudgetProgress`, unconverted amounts); `layouts/<layout>-dashboard.tsx`
only arrange them, under the same ESLint rule, and hybrid uses the bento one. A period with no
income, no expenses and nothing unconverted gets one line under the controls ("Nothing recorded
in October 2026.") with Add and Import links (`DashboardStatus`); the tiles stay. Charts are plain SVG
in theme tokens; the trend has a table under "Show as a table" and category bars carry their
figures as text.

**Ledger feature** (`features/ledger`). Accounts and categories screens write through REST
(`data/ledger.ts`) and then call `useSyncNow()` (a push and pull), so the local store
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
  the server applies each mutation ID once, so an overlapping push is harmless. A flush resets
  only `sending` mutations older than 60 s (twice the 30 s request timeout), whose tab died
  mid-flush; a younger one may be another tab's push in flight.
- **Flush triggers.** App start, the `online` event, becoming visible, 500 ms after a local
  write, and a 60 s heartbeat while visible and online. Transport errors and 5xx retry with
  backoff doubling from 1 s to 5 min, each wait drawn from its upper half. Offline, nothing is
  pushed. A push that left but got no answer (network error, 5xx) leaves its mutations
  `retrying`: the server may hold their results, so they are replayed unchanged and later edits
  queue behind them. A push that changed nothing (failed before the request left, or a 4xx such as 429) leaves them `queued`, still open to coalescing. A mutation that cannot be serialized
  fails on its own (`INTERNAL`) instead of stalling the queue.
- **Slow pushes.** The server applies a push one mutation at a time behind the ledger lock. It
  answers only the mutations it reached once 10 s have passed or the client has disconnected; the
  flusher sends the rest at once, as it does with any mutation left without a result. A batch
  therefore never outlasts the client's 30 s timeout, and no work continues for a request nobody
  waits for. Before this, a loaded server kept finishing abandoned batches while every retry timed
  out and backed off, which stalled sync for minutes. `test/sync-load.int.test.ts` (`LOAD_TEST=1`)
  reproduces the load.
- **Offline start.** The service worker (`vite-plugin-pwa`, Workbox `generateSW`) precaches the
  shell with an `index.html` navigation fallback; `/api/*` is on the navigation denylist and
  has no runtime caching. The last signed-in user is kept in `localStorage['spending.lastUser']`
  so an offline start opens their local data; it is removed on sign-out and when the session
  ends. A page started offline fetches the CSRF token before its first write (`client.ts`).
- **Install and update.** The manifest carries only the brand name "Spending", identical in every
  locale, so one manifest serves all languages; theme and background colours are the light
  tokens as hex. A new version installs in the background (the browser checks on navigation,
  the app hourly) and waits; `app/update-prompt.tsx` offers "Reload" in the user's language.
  Only that click activates it, and only the clicking tab reloads: other tabs keep their unsaved
  input and their own prompt. Queued mutations live in IndexedDB, so they survive the reload.
- **Device privacy.** Signing out with unsent mutations asks first and offers "Sync now"; signing
  out deletes the user's database and the query cache (`clearLocalUserData`). A
  `401` keeps the database, so the queue syncs when the same user signs in again. Only a `401`
  carrying the API's error envelope ends the session; a bare one (e.g. from a proxy) is retried
  like a network error. Before a user's
  store opens, every other database in the registry is deleted, along with its unsent changes.
  Once the store is open the app calls `navigator.storage.persist()`. Without IndexedDB (private
  mode, quota) local-data screens explain that offline is unavailable; REST screens keep working.
- **Status badge.** "Syncing" shows only after 300 ms and "synced" stays at least 600 ms, so a
  quick sync never flickers. The badge is a polite live region.
- **Conflicts.** The server keeps its row and records the client's version (BR-19); history
  shows the server row marked "Needs review", so totals count it once. The sync center (`/sync`,
  reached from the badge) lists open conflicts, then the entries whose change the server refused
  (with the reason) and those still waiting to be sent, each linking to the entry; it says
  everything is in sync only when no conflict or unsent change is left. The conflict review dialog shows both versions side by
  side, highlights the differing fields and names them in its description, so a screen reader
  announces them. A deletion on either side is shown as "Deleted" and offers only keep server or
  keep mine; otherwise each differing field can be picked (amount and currency together; a
  category with its kind and workspace, an account with its workspace, so a merge stays valid).
  Resolving needs the network: `POST /sync/conflicts/:id/resolve` runs at once, and its row
  closes the conflict locally (`settleConflict`); a change still queued for the
  entry is rebased onto that row, so it does not conflict again. Other devices drop it on their next pull,
  which replaces the full conflict list.
- **Rejected changes.** A `rejected` result keeps the overlay and marks the mutation `failed`
  with its code; history shows "Not synced" with the reason from `errors.<code>` (for a rejected
  delete, on the server row) and the entry screen repeats the reason above the form, and other
  entries keep syncing. Editing the entry replaces the failed mutation with a fresh one, since the
  server stores the rejection under the old ID. Discard, on the entry screen or the detail pane,
  drops the failed mutation and the overlay (`discardFailed`): the entry returns to its last
  server row, or leaves the device if the server never had it.

## Sync protocol

Transactions change only through `POST /api/v1/sync/push` (ADR-006). Accounts and categories are
edited through REST and arrive through pull like transactions.

- **Push.** `{ mutations: [...] }`, 1 to 200, applied in order, each in its own ledger transaction.
  A mutation is `transaction.upsert` (`baseVersion` is the version the client edited, or null for a
  new row) or `transaction.delete` (`baseVersion` required). Each result is `applied` (with the
  fresh row), `conflict` (with `conflictId` and the server row) or `rejected` (with a stable code:
  `NOT_FOUND`, `FORBIDDEN`, `INVALID_ACCOUNT`, `INVALID_CATEGORY`, `INVALID_TRANSFER`, `REVIEW_REQUIRED`,
  `MUTATION_ID_REUSED`). Rate limit: 2000 mutations per minute per user
  (`SYNC_MUTATIONS_PER_MINUTE`; E2E raises it to seed large histories), counted by the mutations in each push, since each one holds the
  ledger lock; a push over the budget is refused whole with `RATE_LIMITED`.
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
  Pending-review rows are included; the client hides them. Every page also carries `epoch`, the
  uuid in the single-row `sync_epoch` table, which only `deploy/after-restore.sql` changes.
- **Moves.** When an author moves a row to their other workspace, a `sync_tombstones` row for the
  workspace it left is written at the move's revision, and other users' open conflicts on it are
  dropped. Members of that workspace pull it once as a tombstone in `transactions`. Later edits
  of the row touch only `transactions`, so they never reach the old workspace (BR-2). A tombstone
  is skipped for a viewer who can see the row live again. Family deletion writes none, because
  the workspace and its tombstones are deleted with it.
- **Client duties.** Drop local rows of workspaces missing from `workspaces` (BR-17). An entry
  there with a pending change stays, its latest change failed with the client-only code
  `NO_ACCESS` until the user discards it. When a new workspace id appears (the user joined a
  family), reset the cursor to 0, because that workspace's rows predate the cursor. When `epoch`
  differs from the stored one (BR-35), discard the page, drop every cached server row (accounts,
  categories, conflicts, and entries without a pending change), store the new epoch and pull from 0. Unsent mutations stay queued and replay idempotently (BR-18).
- **Timeouts.** Every API connection runs with `statement_timeout` 30 s, `lock_timeout` 10 s
  (which bounds the wait for the ledger lock) and `idle_in_transaction_session_timeout` 60 s, and
  waits at most 10 s for a pool connection. A statement or lock timeout answers
  `503 UNAVAILABLE` with nothing committed; the client keeps the push queued and retries it.
- **Transfers (BR-37, ADR-016).** An upsert carries `transferId` and `transferOutside`. Both are
  optional on the wire: a client older than transfers (a queued mutation, a tab open across a
  deploy) leaves them out, and the row keeps its mark. The server checks the other live rows with
  the same `transferId`. The web writes both sides of a mark, unmark, delete or date/note edit in
  one IndexedDB commit (`data/sync/transfer.ts`), one queued mutation per side; recording a new
  transfer in the entry form writes both new sides the same way. The form's third type,
  `transfer`, exists only in `features/transactions/form-model.ts`. History builds the
  combined transfer row on the device (`features/transactions/history-model.ts`). Import undo,
  and sync after a push or a resolution that took a side out of a transfer, set
  `transferOutside` on a live side left without a live partner (`releaseLoneSides` in
  `ledger/ledger.service.ts`).
- **Account references (BR-3).** A viewer who cannot see a row's account receives
  `accountId: null`. Sending that null back in an upsert keeps the author's account. Only the
  author may choose an account from their own personal workspace.
- **Author names.** A row carries its author's display name as read at pull time. Sign-in
  refreshes the name from the provider without bumping any revision, so rows a device already
  holds keep the old name until each changes or the cursor resets. Accepted: the name is a label,
  and stamping every authored row on a rename would rewrite the ledger for cosmetics.

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

## Statement import

Statements are parsed in the browser (`features/imports`), so header metadata (names, tax id,
passport, IBAN, card numbers) never leaves the device (BR-36). The pipeline is one data shape, a
table of text cells (`Row = { line, cells }`), made by a reader per format:

- `statement.ts` sniffs the bytes (zip magic is XLSX, the OLE magic is a legacy `.xls` and is
  refused, `%PDF` or a CMS SignedData is PDF, anything else is CSV), applies the size limit of
  that format, finds the header row and the row limit (BR-26).
- `csv.ts` decodes UTF-8 or Windows-1252, detects the delimiter and splits RFC 4180 rows.
- `xlsx.ts` reads the zip with `DecompressionStream('deflate-raw')` and the XML with
  `DOMParser`: first sheet, shared and inline strings, numbers at Excel's 15 digits, date-styled
  numbers as `YYYY-MM-DD`. Rows are padded to one width, as a CSV pads its metadata lines.
- `pdf.ts` unwraps monobank's CMS signature, lazy-loads pdf.js (worker from our origin, no
  WebAssembly) and rebuilds the table from text positions (ADR-015). It returns the header row
  first, so the shared header and row-limit step applies unchanged.
- `mapping.ts` owns presets (matched on the header signature), value parsing (the only money
  parser), card listing, skipped rows and the running-balance check (`prepareRows`), and the
  remembered mapping per header signature in `localStorage['spending.importMapping:<headers>']`.

A new format only needs a reader that returns rows and a branch in `statement.ts`.
The server receives the normalized rows and the mapping (column indexes, formats, file kind) and
validates them as before.

**Transfer suggestions (BR-38).** For confirmed imports, `ImportsService.create` loads the live,
confirmed, non-transfer entries on the workspace's other accounts within 3 days of the batch in
one query, the rates of their currencies on the imported dates, and the user's display name, and
calls the pure `imports/transfer-match.ts`. The result, `imported.transferSuggestions`
(`{ transactionId, counterpartId | null, reason }`), is returned and never stored. The summary
(`features/imports/transfer-suggestions.tsx`) shows the ones still open on the device and confirms
through `markTransfer`, so a confirmation queues like any mark and works offline.

Rows awaiting review get theirs from `ImportsService.review`: the same matcher, with the queue's
rows as the imported side and as extra candidates beside the confirmed entries of the personal
workspace, so two pending rows can pair; such a pair is reported on both items
(`transferSuggestion`). A confirm item may carry `transfer: { counterpartId | null }` (personal,
no category, else 400). `confirm` links it in the same ledger transaction: one shared
`transferId`, set on a confirmed counterpart too, or `transferOutside` for null. The counterpart
must be a live non-transfer row of the personal workspace on another account, used once, either
confirmed or a pending item of the same request pointing back; `transferError` from
`ledger/rules.ts` checks the workspace and kind. Anything else is `422 INVALID_TRANSFER`. The
version trigger bumps the linked rows, so devices pull them. The review page
(`features/imports/review-page.tsx`) shows a Transfer toggle per suggestion, sets it on both rows
of a pending pair and publishes them together (`review-choice.ts` holds the choice shape).

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
  app is same-origin. Rate limits apply to auth, invitations, imports, recurring rules, data export and
  deletion, and sync, per user when signed in, else per IPv4 address or IPv6 /64.
- Secrets live only in Coolify's environment panel. Logs carry request ID, route, status and
  duration only. Never bodies, amounts, notes or tokens.
- CSP and security headers are static in nginx (`deploy/security-headers.conf`): scripts are
  same-origin only; styles allow `'unsafe-inline'` (ADR-011).

## API errors

Every error is `{ error: { code, message, details? } }` with a stable `code` from
`apps/api/src/common/errors.ts`, which the web app localizes. Codes outside the generic HTTP set:
`SESSION_REVOKED`, `CSRF_FAILED`, `CONFIRMATION_MISMATCH` (400), `FAMILY_EXISTS` (409),
`OWNER_CANNOT_LEAVE` (409), `NAME_TAKEN` (409), `REVIEW_REQUIRED` (409), `MUTATION_ID_REUSED`
(409), `INVITATION_INVALID` (410), `INVALID_ACCOUNT` (422), `INVALID_CATEGORY` (422), `INVALID_TRANSFER` (422). Sync push
reports rejections per mutation with the same codes instead of an HTTP error. A database
statement or lock timeout is `503 UNAVAILABLE`, safe to retry. A workspace the actor does not belong to
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
