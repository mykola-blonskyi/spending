# Architecture Decisions

Status of every ADR is Accepted unless noted. Dates are when the decision was made.

## ADR-001: Modular monolith, one repository

Date: 2026-10-14

**Context.** The spec requires `apps/api` (NestJS, Drizzle, PostgreSQL) and `apps/web` (React,
Vite) in one repository, with no microservices.

**Decision.** Use a pnpm workspace with two apps. The API is one deployable NestJS process with
modules `auth`, `users`, `workspaces`, `ledger`, `budgets`, `recurring`, `sync`, `data-rights`,
`imports`, `analytics`, `database` and a small `common`. Modules call each other only through exported
services. The web app gets API types generated from the API's OpenAPI document, so no shared
contracts package is needed.

**Consequences.** One build, one migration stream, one process to operate. The OpenAPI file is
committed and CI fails when it drifts from the code.

## ADR-002: NestJS 11 with zod validation, TypeScript 6

Date: 2026-10-14

**Context.** NestJS 12 is current, but `nestjs-zod` (zod DTOs with OpenAPI generation) only
declares support for Nest 10 and 11. NestJS 11 still receives patch releases (11.2.7 on
2026-09-30). `typescript-eslint` supports TypeScript below 6.1, so TypeScript 7 is out.

**Decision.** NestJS 11, `nestjs-zod` 5 and zod 4 for request validation and OpenAPI. The
document is emitted as OpenAPI 3.1, which avoids the 3.0 down-conversion bugs reported against
zod 4.5+. TypeScript 6.0 everywhere.

**Alternatives.** Nest 12 with class-validator is verbose and weak for discriminated unions
(sync mutations). Nest 12 with an unreleased nestjs-zod build is not a boring choice.

**Consequences.** Upgrade to Nest 12 once nestjs-zod releases support. The zod schemas are the
single source of truth for validation and API types.

## ADR-003: The API is a confidential OIDC client (BFF); opaque server sessions

Date: 2026-10-14

**Context.** `login.blonskyi.dev` supports only confidential clients (`client_secret_basic`).
It requires PKCE S256 and signs ID tokens with RS256. It enforces site approval and the
per-project grant before issuing a code. A pending or ungranted user stays on the provider's 403
page and never returns to the client. Access and ID tokens live 5 minutes. Refresh tokens live
24 hours, rotate on every use, and fail with `invalid_grant` after a grant is revoked.

**Decision.**

- The NestJS `auth` module runs the authorization code flow with `openid-client` 6. It checks
  state, nonce, PKCE S256, issuer, audience, signature and expiry.
- On callback it upserts the user by `sub` and creates an opaque session. The cookie value is 32
  random bytes, and the DB keeps only its SHA-256 hash. The cookie is `__Host-spending_session`:
  HttpOnly, Secure, SameSite=Lax, Path=/. The session is rotated on login and every 24 hours.
  Rotation rewrites the row's token hash in place and keeps the old hash for 60 seconds, so
  requests already in flight still succeed and the grant data never exists in two rows. An old
  token arriving later gets `401` but leaves the cookie alone, since the browser may already hold
  the new one. Sessions end after 30 days absolute or 14 days idle.
- The encrypted refresh token is kept with the session. On a request more than 5 minutes after
  the last grant check, the API refreshes. `invalid_grant` destroys the session
  (`SESSION_REVOKED`). A conditional update lets one concurrent request perform the refresh, since
  reusing a rotated refresh token makes the provider revoke the chain. A provider outage or
  timeout lets the request through.
- CSRF: unsafe methods require an `X-CSRF-Token` header equal to the session's token (returned
  by `GET /api/v1/auth/session`) and an `Origin` equal to the app origin. When a browser omits
  `Origin`, `Sec-Fetch-Site: same-origin` is accepted instead.
- ID token signatures are verified even over TLS (`enableNonRepudiationChecks`), because
  `openid-client` skips that check by default.
- The browser never sees any OIDC token.

**Consequences.** Grant revocation takes effect within 5 minutes. The app cannot detect "pending
approval". The sign-in screen explains that a user who is not let in should wait for the owner's
approval, and the error screen offers retry. Logout destroys the app session and calls the
provider's RP-initiated logout, which revokes this client's refresh tokens. The provider keeps
its own session (a documented provider gap).

## ADR-004: Deploy as a Coolify compose stack, triggered by the Coolify API

Date: 2026-10-14

**Context.** The VPS runs Coolify 4 with Traefik as the only reverse proxy, Cloudflare in front,
and one shared Postgres 18 with a database and least-privilege role per project. The todolist
project deploys by having GitHub Actions call Coolify's deploy API and poll until a terminal
state. The spec asked for an SSH deploy user. On this host, any account able to run the stack
must be in the `docker` group, which is root-equivalent.

**Decision.** A Coolify Docker Compose resource built from this repository:

- `web`: nginx serving the Vite build with static CSP and security headers. It proxies `/api`
  to `api` on the private network. Only `web` gets a domain.
- `predeploy-backup` then `migrate`: one-shot jobs. The first takes a `pg_dump` into the
  `spending-backups` volume, the second applies migrations once the dump succeeded. `api`
  starts only after both succeed.
- `api`: NestJS.
- `backup`: daily `pg_dump` with retention.

`deploy.yml` (manual `workflow_dispatch`, main only) re-runs CI for the commit, then calls
Coolify's deploy endpoint with a token limited to deploy and read. It polls the deployment and
checks `/api/health`.

**Alternatives.** An SSH deploy user would need docker group membership (root-equivalent) or a
sudo wrapper that reimplements what Coolify already does. A second proxy (Caddy or a host nginx)
would conflict with Traefik.

**Consequences.** No SSH key or host key lives in GitHub. The only deploy secret is a
narrow-scope Coolify token. nginx inside the web container is a static file server behind
Traefik, not a second edge proxy.

## ADR-005: CSV statement import is the bank-data path; no AISP connector

Date: 2026-10-14

**Context.** The researched options:

- **GoCardless Bank Account Data** stopped accepting new accounts in July 2025.
- **Enable Banking's free "restricted production mode"** reads only accounts the application
  operator links, for individual non-commercial use. That excludes family members' banks. Its
  terms and its Santander ES support are unverified.
- **Tink, TrueLayer, Yapily, Salt Edge and Plaid** are commercial and need a contract.
- **Direct Redsys PSD2 access** needs an AISP licence and an eIDAS QWAC.

**Decision.** Ship CSV import with column mapping, Spanish formats (semicolon, decimal comma,
`dd/mm/yyyy`, Windows-1252), dedupe and review. Build no bank connector until a free, legal
channel is proven for every user who would use it.

**Consequences.** No connection secrets or consents to store. Users download a statement from
BBVA or Santander online banking and import it.

## ADR-006: One write path for transactions: the sync mutation endpoint

Date: 2026-10-14

**Context.** Transactions must be creatable, editable and deletable offline, with idempotent
retries and conflict records.

**Decision.** The web app writes transactions to IndexedDB and a durable mutation queue. Online
or not, the queue is flushed to `POST /api/v1/sync/push`. That endpoint is the only API that
creates, updates or deletes transactions, apart from server-side import and recurring jobs and
conflict resolution. `GET /api/v1/sync/pull?cursor=` returns changes by global revision. Accounts
and categories are pulled for offline use but edited online through REST. History search and
filtering run on the local store. `GET /api/v1/transactions` offers the same filters server-side
for export and API clients.

**Consequences.** There is no second code path whose access checks can drift. Offline and online
behave identically.

Revisions come from one sequence, assigned by the `ledger_stamp` trigger under a
transaction-scoped advisory lock. Revision order therefore equals commit order, and a pull cursor
cannot skip a write that commits late. The cost is that ledger writes are serialized, one writer
at a time for the whole database. We accept that throughput limit at household scale, where a
push carries at most 200 mutations and is limited to 120 per minute per user. Service code
writes the ledger only through `ledgerTransaction`, which takes the lock before any row lock, so
writers cannot deadlock. Sign-in runs under it too, because a first login seeds the personal
workspace's default categories. So do leaving and removing a family member, so a push that read
the old membership cannot record a conflict after BR-9 dropped them. `transactions.version` increments only on user-visible changes,
so background FX fills never cause conflicts.

## ADR-007: EUR base currency, ECB reference rates

Date: 2026-10-14

**Decision.** Base currency is fixed to EUR. Rates come from the ECB daily and historical XML
feeds (free, no key), fetched daily by the API into `fx_rates`. Conversions are stored on the
transaction with rate, rate date and source.

When an unconverted non-EUR row falls where no rate of any currency is stored, while its currency
has a later one (a CSV statement from before the 90-day window, or an outage longer than it), the
API loads the full ECB history (`eurofxref-hist.xml`, about 30 MB, since 1999), then backfills. It
runs at most once per 24 hours per process, with a 60 s timeout and a 60 MB limit, and keeps days
already stored. Once those days are stored, the condition clears.

**Consequences.** Analytics show unconverted amounts separately when no rate exists. The ECB
publishes about 30 currencies, and others stay unconverted. A rate the ECB later revises for an
already stored day updates `fx_rates` but is not re-applied to rows already converted with it.

## ADR-008: At most one family per user; scope is the workspace

Date: 2026-10-14

**Decision.** Each user has a personal workspace. Family mode adds one family workspace. A
transaction's scope is the kind of the workspace it belongs to, so scope and ownership cannot
disagree.

**Consequences.** The entry form chooses between two workspaces. Supporting several families
later needs a workspace picker, not a schema change.

## ADR-009: Frontend stack

Date: 2026-10-14

**Decision.**

- React 19 with Vite 8 and react-router 8.
- Tailwind CSS 4, shadcn/ui under `@shared/ui`, and `lucide-react` icons.
- TanStack Query for server state, Zustand for UI state, TanStack Virtual for history.
- `use-intl` for i18n, `idb` for IndexedDB, plain SVG charts, `vite-plugin-pwa` with Workbox
  `generateSW`.
- Layer boundaries are enforced by `eslint-plugin-boundaries`.

**Consequences.** The service worker precaches the shell only. `/api/*` is network-only and is
never cached.

## ADR-010: GitHub Actions within the free allowance

Date: 2026-10-14

**Context.** The repository is public, so standard GitHub-hosted runner minutes are free.

**Decision.** Use only standard `ubuntu-latest` runners and pin actions to commit SHAs. Set the
`GITHUB_TOKEN` to `contents: read` by default. Set an Actions budget of $0 with "stop usage when
budget limit is reached" on the owner account. If the repository becomes private, the 2,000 free
minutes apply and jobs stop when they run out.

**Consequences.** CI never incurs charges. Larger runners are never used.

## ADR-011: Content Security Policy allows inline styles, not inline scripts

Date: 2026-10-14

**Context.** sonner (toasts) and Radix's scroll lock (`react-remove-scroll`) inject `<style>`
elements at runtime, and Radix positions popovers with `style=""` attributes. `style-src 'self'`
blocks the elements, which breaks toasts and scroll locking in dialogs. The CSP must stay static
(ADR-004), so a per-response nonce is not available.

**Decision.** Keep `script-src 'self'` strict. Use `style-src 'self' 'unsafe-inline'` and drop the
separate `style-src-attr` directive.

**Alternatives.**

- Hashes of the injected styles: they change with every library update and break silently.
- Nonces: contradict the static-CSP requirement and need a server-rendered shell.
- Replacing sonner and Radix's scroll lock: high cost for a small gain.

**Consequences.** CSS injection still requires an HTML injection first, which React's escaping
prevents. Scripts stay strictly same-origin, so the policy still blocks injected script
execution and cross-origin script loading.

## ADR-012: The database stores keys, never translated display text

Date: 2026-10-16

**Context.** Default categories were seeded with English names next to a `systemKey`, and only
the ledger pages translated them by comparing the stored name to the English default. Every other
list (budgets, recurring rules, import review, history filters, conflicts) showed the English
name. The personal workspace was stored as "Personal" the same way.

**Decision.** Anything the app translates is stored as an identifier. `categories.name` and
`workspaces.name` are nullable: a default category and the personal workspace have no stored
name, and the web derives the display name from `systemKey` (or the workspace kind) in one
module, `features/ledger/category-view.ts`. A stored name exists only once the user set one. An
ESLint rule bans `useCategories` outside that module, so no screen can fall back to raw rows.
Migration `0010` nulls the seeded English names (a renamed category keeps its name).

**Alternatives.** Translating in every consumer (what broke); comparing stored names to the
English catalog (breaks on rename to an English word, and silently stores display text).

**Consequences.** The API, exports and E2E helpers return `name: null` for defaults, with
`systemKey` as the stable identifier; the CSV export, built in the web client from the display
names, writes the localized default name for an unnamed category.
Name uniqueness per `(workspaceId, kind)` covers stored names only, so a custom category may
carry the same words as a default's localized name.

## ADR-013: Prune sync mutation outcomes after 180 days instead of capping offline age

Date: 2026-10-16

**Context.** `sync_mutations` keeps every push outcome so a replay returns it (BR-18), and nothing
removed rows, so the table grew forever. Pruning is safe only if a replay of a pruned mutation
cannot duplicate a row or silently overwrite a newer change.

**Decision.** A daily job deletes outcomes older than 180 days. A replay after that is decided
again on the row: transaction IDs are client-chosen primary keys, so a create cannot duplicate; a
create or update whose base version is older than the row answers applied if the row already
holds that intent and a conflict otherwise (BR-19); a delete of a deleted row succeeds. An
integration test replays pruned creates, updates and deletes to prove it.

**Alternatives.**

- Reject mutations older than a maximum offline age and force a resync: needs a client state and
  a wipe of local edits, for a guarantee the row-level checks already give.
- Keep every outcome: unbounded growth for no benefit after the client has its answer.

**Consequences.** A device that stays unanswered for over 180 days may see a conflict for its own
already-applied change, instead of the stored outcome. A rejected outcome is decided again and can
now succeed if what made it fail was fixed.

## ADR-014: Read XLSX statements in the browser with an in-house reader

Date: 2026-10-17

**Context.** Santander, monobank and PrivatBank export statements as XLSX (monobank names its file
`.xls`). The header block carries the holder's name, date of birth, tax id, passport, address,
card numbers and IBAN. ADR-005 made the CSV import the bank-data path and parses it in the
browser.

**Decision.** Parse XLSX in the browser too, with a small reader on `DecompressionStream` and
`DOMParser` (first sheet, shared and inline strings, numbers, date serials), and turn it into the
same cell table the CSV path makes. The format is detected from the bytes, not the extension.
Legacy binary `.xls` is refused with a message. Known banks are recognized by their header row.

**Alternatives.**

- SheetJS or ExcelJS: hundreds of kilobytes for features a statement never uses, and a dependency
  to track for parser security fixes.
- Server-side parsing: the metadata block would leave the device (BR-36).

**Consequences.** No new dependency. The reader takes formula cells by their cached value and
skips ZIP64, CRC checks and every sheet but the first; a part over 64 MiB or a sheet over 100
columns is refused. PDF statements will reuse the same cell table and mapping step.

**Addendum (category hints, #104).** The mapping step has two optional roles, bank category and
MCC, set by the PrivatBank and monobank presets. Each row carries them as optional request fields,
used only by BR-29. Neither is stored anywhere, on the server or on the device (#101, decision
13). The import response echoes each imported row's bank category, and the browser holds it in
memory for that tab. While the import screens are open, it sends the bank category with the
user's category choice: per item on the review confirmation, and to `POST /v1/imports/learn` for
choices on the import summary, since those edits otherwise travel through the sync queue, which
would persist the hint in the local store. A correction made later, from history, learns only the
description rule; a lost bank-category rule is cheaper than a stored bank category. The MCC is
matched against a fixed table and never learned. The amount parser also accepts "грн" and "₴"
for UAH.

## ADR-015: Rebuild PDF statement tables from the text layer with pdf.js

Date: 2026-10-17

**Context.** UkrSibbank exports statements only as PDF; Santander and monobank offer PDF too.
monobank's PDF is wrapped in a CMS SignedData (DSTU) signature. The same header metadata as in
XLSX (ADR-014) must stay on the device, and the CSP allows scripts and workers from our origin
only.

**Decision.** Read PDFs in the browser with `pdfjs-dist` (exact pin), imported only when a PDF is
opened, its worker built as a same-origin `.js` asset (nginx's `mime.types` has no `.mjs`), and
WebAssembly off (it only decodes images). One generic layout parser turns positioned text into
the shared cell table: lines by baseline, the header as the lowest same-size block above the first
date line, column edges in the emptiest gutter between header centres, and lines without a date
joined to the row above until a wide gap or a totals line. A header repeated on a later page
continues the table; a later table with every column of the first joins it by label (UkrSib's
card operations), one without (UkrSib's pending holds) is left out. The CMS wrapper is opened by
a DER walk to the OCTET STRING that starts with `%PDF`; the signature is not verified.

**Alternatives.**

- A layout template per bank: exact, but every bank redesign breaks it, and other banks get
  nothing.
- Server-side extraction (pdftotext, Tabula): the metadata block would leave the device (BR-36).
- Scanning for `%PDF` … last `%%EOF` in the CMS file: shorter, but wrong for a chunked OCTET
  STRING, which the DER walk joins.

**Consequences.** About 490 kB of pdf.js plus a 1.2 MB worker, loaded only when a PDF is opened and
kept by the service worker from then on (not precached, so other users never download it). A scanned PDF (no text) is refused with a message; OCR is out
of scope. BER indefinite-length CMS wrappers are refused. Limits: 10 MiB and 100 pages.

## ADR-016: A transfer is two ordinary entries sharing a transfer id

Date: 2026-10-17

**Context.** A move between the user's own accounts shows up as an expense on one account and an
income on the other, so once both statements are imported it inflates income, spending,
categories and budgets (#105). Transfers must work offline, keep conflicts and import undo as
they are, and stay within one workspace (BR-2).

**Decision.** A transaction gains a nullable `transferId`, shared by the two sides, and
`transferOutside` for a one-sided transfer whose other account is outside the app. Each side
stays an income or expense entry in its own account's currency, with no category; a check
constraint enforces the missing category. Analytics filter `transferId is null`; budgets need no
filter, because a transfer has no category. Marking and unmarking are ordinary
`transaction.upsert` mutations, one per side, queued together in one local commit. The server
validates each side against the other live sides (same workspace, opposite kind, at most two,
one-sided alone) and answers `INVALID_TRANSFER` otherwise. Version bumps include both columns,
so a mark made elsewhere turns a stale edit into a conflict.

**Alternatives.**

- A `transfers` table referencing both entries: a second synced entity with its own pull,
  conflicts and tombstones.
- One `transfer.link` mutation applying both sides in one ledger transaction: atomic, but a stale
  side needs a new kind of conflict spanning two rows.
- A third entry kind `transfer`: one row cannot hold two accounts in two currencies, and every
  income/expense branch would need a third case.

**Consequences.** Each side commits on its own, so between two pushes, or when one side
conflicts, a pair can be half linked; that side is already out of the totals and the conflict is
resolved like any other. Deleting both sides, the shared date and note, the combined history row,
import undo and exports (#108) and the entry form type (#109) build on the same two columns
without a migration: a delete or edit queues one ordinary mutation per side in one local commit,
the combined row is built on the device from the sides it holds, and import undo sets
`transferOutside` on a side whose partner it deleted, which bumps its version so devices pull it.
The entry form's Transfer type exists only in the form: saving it queues two new sides, an
expense and an income, in one local commit, so the wire and the server see two ordinary upserts.
Import suggestions (#110, BR-38) add no column either: the server computes them while it holds
the import's ledger transaction, from one candidate query and the rates it already loads, and
returns them in the import response. The browser shows them only on that import's summary, and
confirming one is the ordinary mark, so a reload or another device simply has no suggestions.
