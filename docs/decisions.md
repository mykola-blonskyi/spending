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

## ADR-012: Prune sync mutation outcomes after 180 days instead of capping offline age

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
