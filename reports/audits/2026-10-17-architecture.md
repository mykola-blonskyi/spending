# Audit Report

Date: 2026-10-17

Auditor: Claude Code (read-only investigation, main at 5cd4592)

Audit Type: Architecture and code health

---

## Scope

- `apps/api/src`, all modules. Their dependency direction, the pure rule files and the services.
- `apps/web/src`. The layers, `data/sync` (queue, push, pull, store, engine, transfer),
  `features/*`, and the 8 layouts with their shells.
- `.github/workflows`, `docker-compose.yml`, `deploy/`, and the migration runner.
- The documentation set. `docs/architecture.md`, `docs/decisions.md`, `docs/operations.md`,
  `knowledge/*`, `graph/*`, and the previous audit, `reports/audits/2026-10-16-database.md`.

How the evidence was gathered:

- I read the documentation first, then the code.
- I mapped the module import graph with grep.
- I checked for runtime import cycles with a Tarjan pass over the non-test `.ts`/`.tsx` imports. It
  found none in either app.
- `corepack pnpm dlx knip` ran and reported 4 unused files and 41 unused exports.
- I ran these checks locally and all passed:
  - `eslint`;
  - `tsc` for each app;
  - the API unit tests (311);
  - the web unit and component tests (752).

The root `pnpm typecheck` and `pnpm test` fail locally only because nested `pnpm` is not on PATH.
That is an environment problem, not a code problem. Integration and E2E tests were not run.

Out of scope. Database query performance, which the 2026-10-16 audit covered. Its High and Medium
findings are fixed. The sync epoch, timeouts and the FX index are all in migration 0009 and in
`database.module.ts:60-62`.

---

## Findings

### Critical

- None.

### High

- None. The sync protocol, idempotency, revision cursor and access checks hold up under review.
  Nothing found risks data loss or a data leak.

### Medium

#### M1. Domain rules live in sync's wire-schema file, so `imports` and `recurring` depend on `sync`, and the reference checks are duplicated

- **Where.**
  - `apps/api/src/sync/mutations.ts:128` (`referenceError`) and `:212` (`transferError`) sit beside
    the push and pull zod schemas.
  - `imports/imports.service.ts:13` and `recurring/recurring.service.ts:17` import them from sync.
  - `sync/sync.service.ts:32` imports `learnCategoryRules` from imports.
  - Together these make a module-level cycle between `sync` and `imports`. It is not a file-level
    cycle.
- **Duplication.**
  - The account and category facts are loaded twice, with the same select-and-map, in
    `sync/sync.service.ts:548-568` (`accountFact`, `categoryFact`) and
    `recurring/recurring.service.ts:207-235`.
  - `imports/imports.service.ts:376-386` re-implements the BR-4 category check (workspace, kind,
    archived unless unchanged) instead of calling `referenceError`.
- **Cost.**
  - BR-3, BR-4 and BR-37 are ledger invariants, but their owner is the sync transport.
  - A BR-4 change must be made in two places, and the review confirmation can drift from sync.
- **Fix (mechanical).**
  - Move `referenceError`, `transferError`, `sameIntent` and their fact types into
    `ledger/rules.ts`.
  - Add one `referenceFacts(tx, accountId, categoryId)` loader there. Use it from sync, recurring and
    `ImportsService.confirm`, and delete the two private loaders.
  - `mutations.ts` keeps only wire schemas and `decideUpsert`/`decideDelete`.
  - Move `learnCategoryRules` to `ledger/` (or leave it). Either way, the module cycle disappears.
  - Net change is about −40 lines. The architecture.md sentence "`transferError` from
    `sync/mutations.ts`" changes with it.

#### M2. A permanent half-transfer is a representable, silent state

- **Where.**
  - `sync/mutations.ts:222-229`. `!peer` means "fits". By design, the first side of a pair may
    arrive alone.
  - `apps/web/src/data/sync/push.ts:144` (`discardFailed`) touches only its own entry.
  - Resolving a conflict with `server` keeps whatever the other side became.
- **Scenario.**
  - Side A is pushed and applied. Side B is rejected or conflicts.
  - The user discards B's failure, or resolves B's conflict with "keep server".
  - A is now left with `transferId` set, `transferOutside = false` and no peer.
  - Analytics filter `transferId is null`, so A's amount is out of every total for good. History
    shows it alone, as for "partner not on the device". Nothing tells the user it is orphaned.
  - ADR-016 accepts this as a transient state ("a pair can be half linked"). The discard and
    resolve paths are how it becomes permanent.
- **Cost.** Real money silently leaves the totals. It is rare, but nothing ever repairs it.
- **Decision (owner).**
  1. **Server repair, as import undo does.** When a delete or unmark leaves a single linked side,
     set `transferOutside = true` on it. Small, but it is a second place where the server writes the
     other side, and the user never chose "outside".
  2. **Client repair.** `discardFailed` and conflict resolution, on a transfer side, also queue an
     unmark (or an outside mark) of the remaining side. This stays within "one local commit,
     ordinary mutations" (ADR-016), but only fixes devices that hold both sides.
  3. **Make it visible.** History marks a side whose `transferId` has no partner after a full sync
     as "Transfer incomplete", with mark and unmark actions. This is the cheapest and changes no
     invariant, but needs a UI string and a rule in `history-model.ts`.

#### M3. Editing one side of a transfer still offers income/expense, and switching it is always rejected

- **Where.**
  - `apps/web/src/features/transactions/blocks/entry-fields.tsx:82` and
    `layouts/journal-entry.tsx:264` offer `expense` and `income` in edit mode, with no
    `form.isTransfer` guard.
  - `use-entry-form.ts:208` `setKind` has no guard either.
  - The category picker is already hidden for transfers (`entry-fields.tsx:188`). The kind picker
    is not.
- **Cost.** Switching makes both sides the same kind. The server answers `INVALID_TRANSFER`
  (`mutations.ts:228`), and the user gets "Not synced" for a choice the UI offered.
- **Fix (mechanical).**
  - Hide or disable the kind control when `form.isTransfer`, in `KindToggle` and in journal's
    `Pills`.
  - Make `setKind` a no-op for a transfer side.
  - Add one component test.

#### M4. The 8-layout design multiplies every entry-form change by seven

- **Size.** `features/transactions/layouts` (2.4k lines), `features/dashboard/layouts` (0.3k) and
  `shared/shell` (1.2k) come to about 3.9k lines. Five test files and a layouts E2E cover them.
- **Evidence from git history.**
  - #113 touched 7 entry layouts to add the transfer action.
  - #114 touched 7 again.
  - #115 touched 4, including +85/−24 lines in `journal-entry.tsx`.
- **The repeated pieces.**
  - The footer (`TransferButton` + `DeleteButton` + discard) is repeated in 7 files, with 14
    occurrences each of `DeleteButton` and `TransferButton`.
  - Journal re-implements its kind and scope pickers as `Pills` instead of `KindToggle`, so M3 needs
    two fixes.
  - Five layouts export a `*EntryView` that only its own `*Entry` uses (bento, journal, playful,
    soft, split).
  - The models and hooks are shared, and the ESLint rule keeps layouts presentation-only. That part
    works.
- **Fix (mechanical, whatever the decision).**
  - Extract one `EntryActions` block for the footer.
  - Use `KindToggle` and `ScopeToggle` in journal with a style prop.
  - Inline the five one-caller `*EntryView` exports.
- **Decision (owner). Is the layout count worth it?**
  1. **Keep all 8, with the extraction above.** Lowest effort. Each new entry feature still needs a
     visual check in 8 layouts.
  2. **Layouts as shells and dashboard arrangements only.** History and entry share one
     implementation, with density variants (calm, compact for split/hybrid, keypad for cards). This
     deletes about 1.5k lines, but gives up bespoke journal, playful and soft entry screens.
  3. **Cut to the layouts real users pick.** Production has 2 users, so ask them. This deletes the
     most, but is visible to users.

#### M5. No alert reaches anyone, and the off-host backup lives on the same disk

- **Where.**
  - `docs/operations.md:338` says "not the loss of the VPS disk, because MinIO stores its data on
    the same disk".
  - `:389-394`. Backup and API failures surface only as container health and log lines on the
    Coolify page.
- **Cost.**
  - A failed daily dump, a failed off-site copy, or an API stuck in 503 stays unnoticed until someone
    opens Coolify.
  - Losing the disk loses every backup.
- **Decision (owner).**
  1. **Coolify notifications** (email or Telegram) on container unhealthy and deployment failed.
     Zero code.
  2. **Point `BACKUP_OFFSITE_REMOTE` at another machine** (B2 or R2, as the runbook already
     describes). The variables already exist.
  3. **An external uptime check** on `/api/health/ready`, e.g. a free Cloudflare or UptimeRobot
     monitor.

  Options 1 and 2 together cost about an hour and close both gaps.

### Low

#### L1. ADR-004 contradicts the actual deploy trigger

- `docs/decisions.md:98` says "`deploy.yml` (manual `workflow_dispatch`, main only)".
- The workflow also runs on `workflow_run` after green CI (`deploy.yml:5-8`), which is what
  `docs/operations.md` "Deploying" describes.
- **Fix (mechanical).** An addendum to ADR-004.

#### L2. ADR-001 says "Modules call each other only through exported services"

- `docs/decisions.md:14` makes that claim. In the code, modules share the Drizzle schema and import
  each other's free functions:
  - `sync`, `imports`, `recurring`, `analytics`, `budgets`, `data-rights` and `workspaces` all
    read or write `transactions` directly;
  - every module's `export-section.ts` imports `data-rights/export-section`.
- That is fine for a modular monolith, but the sentence is false.
- **Fix (mechanical).** Reword it to "modules share the schema; cross-module calls go through
  exported services or pure rule files". After M1 the rule files live in `ledger`.

#### L3. BR-17 says "Every write increments `version`"

- `knowledge/business-rules.md:84` makes that claim.
- `transaction_version` (`drizzle/0011_transfers.sql:6-21`) bumps only on user-visible columns.
  ADR-006 and the domain model say so too.
- **Fix (mechanical).** "every user-visible change".

#### L4. Dead layout fallback and a stale comment

- `app/layouts/registry.tsx:21-23,53-57` types `screens` as `Partial` and falls back to the calm
  screens.
- But every layout defines dashboard, history and entry (`transactions/layouts/screens.ts:29-38`,
  `dashboard/layouts/screens.ts:11-20`).
- `screens.ts:28` still says "every layout starts on the calm screens until it gets its own".
- **Fix (mechanical).**
  - Require all three screens.
  - Keep only `detail ?? entry`.
  - Delete the comment and the fallback (architecture.md:75 too).

#### L5. `GET /v1/transactions` has no client

- The endpoint is `ledger/ledger.controller.ts:104`, `ledger/ledger.service.ts:207-265` and
  `ledger/history.ts`.
- The web reads history from IndexedDB, and the CSV export is built from `/data-export`.
- Only `test/sync.int.test.ts:318` and `test/data-rights.int.test.ts:387` call it.
- **Cost.** A second filtered read path that must keep honouring BR-2, BR-3 and BR-21, plus OpenAPI
  surface.
- **Decision (owner).**
  1. **Delete it**, with about 150 lines and its DTOs. The two tests read via pull or the export
     instead.
  2. **Keep it** as the documented "API clients" path (ADR-006) and accept the upkeep.

#### L6. Dead code reported by knip

- Unused files are `apps/web/src/shared/ui/popover.tsx`, `separator.tsx` and `tabs.tsx`. Re-adding
  one later is one `ui:add` command away.
- 41 exports are used only inside their own file. Examples are `analytics/summary.ts`
  (`GRANULARITIES`, `bucketOf`, …), `sync/mutations.ts` (`PUSH_MAX`, `mutationSchema`) and
  `data/sync/engine.ts` (`WRITE_DEBOUNCE_MS`).
- `e2e/fixtures/make-xlsx.ts` is a generator script, which is a false positive.
- **Fix (mechanical).**
  - Delete the 3 files.
  - Drop `export` from the in-file-only symbols. Leave the shadcn re-exports in `shared/ui/*`, which
    are vendor API.

#### L7. Validation limits are duplicated as literals without a cross-check

- The description limit is the literal `200` in three API places (`sync/mutations.ts:26`,
  `imports/rows.ts:6` and `recurring/rules.ts:18`).
- The web repeats `maxLength={200}`, `2000` and `MAX_AMOUNT_MINOR`, at `shared/format/money.ts:84`
  vs `ledger/views.ts:22`.
- Only the minor-digits table is held equal by a test (`common/money.test.ts:68`).
- **Fix (mechanical).**
  - Add one `DESCRIPTION_MAX` and one `NOTE_MAX` in `ledger/views.ts`, used by all three API
    schemas.
  - Extend `money.test.ts` to compare `MAX_AMOUNT_MINOR` and read the limits from
    `apps/web/src/data/openapi.json` (`maxLength`, `maximum`), which is already committed.

#### L8. Redundant CI job

- The `Production build` job (`.github/workflows/ci.yml:137`) runs `pnpm build`.
- `Playwright E2E` already runs the same build before testing, and `Docker stack smoke test` builds
  the images.
- **Fix.** Delete the job. This needs the owner to remove it from the required checks in the
  ruleset (operations.md "Branch protection").

#### L9. The migrator sets no `lock_timeout`, and the "API is stopped during migrate" premise is unverified

- `apps/api/src/database/migrate.ts:8` creates a plain pool.
- `drizzle/0009_db_audit.sql:1-4` and `docs/operations.md:131` assume the old API is down while
  migrations run.
- `docker compose up` recreates `spending-api` only after `migrate` completes. If the old container
  serves until then, locking DDL queues behind its transactions. These are bounded by the API's 30 s
  `statement_timeout`, and the app's queries on the table wait behind the DDL.
- **Fix.**
  - Set `lock_timeout` on the migrate pool (mechanical).
  - Watch one deploy's container timeline to confirm the doc, or correct it.

#### L10. Empty and stale knowledge files

- `docs/TODO.md`, `graph/architecture.md` and `graph/dependencies.md` are empty templates, yet
  `CLAUDE.md` lists them as sources of truth.
- The `Session` entry in `knowledge/domain-model.md:16-23` lacks `previousTokenHash` and
  `idTokenEnc` (`database/schema.ts:101,107`).
- **Fix (mechanical).**
  - Add the two columns.
  - Delete the empty files, or fill `graph/dependencies.md` with this audit's module map. Deleting
    is preferred; ADR-001 and architecture.md already carry it.

#### L11. Compatibility path for clients older than transfers

- `sync/mutations.ts:28-31` makes `transferId` and `transferOutside` optional.
- `sync.service.ts:359-364` falls back to the stored values when they are absent.
- It exists for mutations queued before #113 (2026-10-17).
- **Decision (owner).**
  1. **Keep it.** About 8 lines.
  2. **Remove it after a set date**, e.g. 30 days. Any old queued mutation would then get 400 and be
     split and rejected (`engine.ts` `#push`). With 2 users it is low risk either way.

#### L12. The local store re-reads the whole database on every commit

- `apps/web/src/data/sync/store.ts:107-134`.
- The initial pull costs O(N²/500) record reads.
- This is a documented shortcut (`store.ts:169-170`) with a 5,000-entry E2E (`e2e/history.spec.ts`).
- **No action now.** Revisit if one history passes about 20k rows, or a phone shows commit latency.

#### L13. `common` imports from `database`

- `common/error.filter.ts:13` imports `isTimeout`, while `database` imports `common/config`.
- **Accept.** Moving `isTimeout` to `common/` would remove the edge, but it is cosmetic.

---

## Sound areas (one line each)

- **Web layering.** ESLint `boundaries` enforces the layer table. The feature graph is acyclic
  (transactions → family, ledger, profile; nothing points back), and there are no runtime file
  cycles in either app.
- **Pure core with thin shells.** Push, pull and conflict decisions (`decideUpsert`,
  `decideDelete`, `pullWindow`) and the reducers (`queue.ts`, `push.ts`, `pull.ts`) are pure and
  unit-tested. Services and the engine only do I/O.
- **Sync design.**
  - The revision sequence under the advisory lock makes the cursor gapless.
  - The idempotency log has a proven pruning story (ADR-013).
  - Results are frozen as `retrying` versus `queued` after an ambiguous or definite failure.
  - Each entry has one mutation per batch.
  - Web Locks plus re-reading inside the IDB transaction keep tabs consistent.
  - The epoch reset after a restore is in place.
  - The push time budget stops abandoned batches.
- **Validation at the boundary.** Zod DTOs are the single source for requests and OpenAPI. CI fails
  on a stale `openapi.json` or `api.gen.ts`.
- **Shared package not needed.**
  - Enums and shapes cross through generated OpenAPI types.
  - Transfer invariants are enforced on the server and satisfied structurally by the web's paired
    writes.
  - Categorization and FX run only on the server.
  - What remains duplicated is a currency table (test-guarded) and a few limits (L7). A package
    would add a build step and a third workspace to fix about 40 lines.
- **Error model.** There is one envelope with stable codes, localized in the web. The sync push
  reports per-mutation codes from the same set.
- **Security posture.**
  - BFF OIDC with PKCE, hashed opaque sessions, CSRF with an Origin check.
  - A static CSP with a reasoned exception.
  - Statement data stays on the device (BR-36).
- **CI and deploy.**
  - Pinned action SHAs and least-privilege tokens.
  - A full-stack Docker smoke test, including log redaction and a backup dump.
  - The deploy waits for green CI on the exact SHA and checks `version` afterwards.
  - The pre-migrate dump is fail-closed.
- **Test strategy against risk.** 18 integration files cover every module, including transfers,
  pruning replays, a load test and migrations. 26 E2E specs include offline, tabs, conflicts,
  rejected changes, privacy and PWA.
  - **Gaps.** M2 (orphan side after discard or resolve) and M3 (kind switch on a transfer side) have
    no test. Neither do the cross-app limits (L7).

---

## Recommendations

### Immediate

- **M3.** Guard the kind control on a transfer side, in `KindToggle`, journal's `Pills` and
  `setKind`, and add one component test.
- **M5.** Turn on Coolify notifications, and point the off-site copy at a provider on another
  machine.
- **L1, L3, L10.** Fix the documentation drift.

### Short Term

- **M1.** Move the reference and transfer rules and their fact loader into `ledger/rules.ts`, and
  use them in `ImportsService.confirm`.
- **M4 (mechanical part).** Extract `EntryActions`, reuse `KindToggle` and `ScopeToggle` in journal,
  and inline the five one-caller `*EntryView` exports.
- **L4, L6, L7.** Delete the dead fallback, the unused files and the redundant `export`s, and add
  one limits cross-check.
- **M2.** Pick a repair option.

### Long Term

- **M4 decision.** Decide how many layouts to keep.
- **L5.** Decide whether `GET /v1/transactions` stays.
- **L11.** Set a removal date for the pre-transfer compatibility path.
- **L12.** Revisit the local store's whole-database commit if histories grow past about 20k rows.

---

## Overall Assessment

The codebase is in good health for its size. It has about 56k lines, 1,063 unit tests passing,
clean lint and typecheck, and no runtime import cycles. The architecture matches its documents in
substance. Business rules are pure functions with tests, the boundaries are explicit, and the sync
engine's subtle cases are named, reasoned and tested.

The real debts are three:

- **Ownership.** Ledger invariants are owned by the sync transport file (M1).
- **Transfer edges.** Two edges of the newest feature leave states the UI can produce but nothing
  repairs (M2, M3).
- **Layout cost.** Eight layouts make every entry change a seven-file change (M4).

Operationally, the gap is not the deploy, which is careful. It is that nobody is told when
something fails, and the backups share one disk (M5). Nothing is Critical or High.

---

## Action Plan

- [x] M3. Guard kind switching on transfer sides, plus a test (mechanical).
- [x] M5. Coolify notifications and an off-machine `BACKUP_OFFSITE_REMOTE` (owner).
- [x] M1. `ledger/rules.ts` with the reference and transfer rules and the fact loader; drop the
      duplicate loaders and the BR-4 copy (mechanical).
- [x] M2. Choose the orphan-transfer repair (owner), then implement it with a test.
- [x] M4. `EntryActions` extraction, journal reusing the shared toggles, inline `*EntryView`
      (mechanical); decide the layout count (owner). Journal keeps its own pills (see Resolution).
- [x] L1, L2, L3, L10. Documentation fixes (mechanical).
- [x] L4, L6, L7. Dead fallback, unused files and exports, a limits cross-check (mechanical).
- [ ] L8. Drop the `Production build` job and the required check (owner).
- [x] L9. `lock_timeout` on the migrate pool, and confirm the deploy timeline (mechanical, then
      observe). The timeline is still an owner observation.
- [x] L5, L11. Delete or keep `GET /v1/transactions`, and the compatibility path's removal date
      (owner).

---

## Resolution

| ID  | Finding                                                 | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Domain rules live in sync's wire-schema file            | this PR. The ledger rules (`referenceError`, `transferError`) and one `loadReferenceFacts` lookup moved to `apps/api/src/ledger/rules.ts`. Sync, recurring and the import review use it, and imports no longer depends on sync.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| M2  | A permanent half-transfer is a silent state             | #119. The server makes a lone transfer side one-sided (`releaseLoneSides`), the owner's option 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| M3  | Kind switch offered on one side of a transfer           | #120. The kind switch is hidden on a transfer side in `KindToggle` and journal, and `setKind` ignores it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| M4  | 8 layouts multiply every entry-form change              | this PR. The owner kept all 8 layouts. One shared `EntryActions` footer (discard, transfer, delete) replaces 7 copies, and the 5 one-caller `*EntryView` components are inlined. Journal keeps its own pills. Reusing `KindToggle` would move the "needs two accounts" hint under the kind group, need about ten class overrides of the toggle base styles and change keyboard behaviour to roving focus. The scope toggle (`ScopeField`) has a visible label and no styling props, and journal's currency pills stay in any case. The M3 rule already lives once in `setKind`. Screenshots of all 8 layouts before and after (`shots.spec.ts`, 448 shots) matched: 446 are identical, and 2 differ by 1/255 on under 40 antialiased pixels. |
| M5  | No alert reaches anyone; backups share one disk         | owner/accepted: owner ops, handled by the owner (Coolify notifications, off-machine backup copy). #121 also makes a failed backup exit so Coolify alerts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| L1  | ADR-004 contradicts the deploy trigger                  | this PR. ADR-004 has an addendum for the automatic deploy on `workflow_run` after green CI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| L2  | ADR-001 claims modules talk only through services       | this PR. ADR-001 says modules share the schema and call each other through exported services or pure rule files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| L3  | BR-17 says every write increments `version`             | this PR. BR-17 says every user-visible change increments `version`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| L4  | Dead layout fallback and a stale comment                | this PR. Every layout must define its screens, and the calm fallback and its comment are gone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| L5  | `GET /v1/transactions` has no client                    | this PR. The owner chose delete. `GET /v1/transactions`, its service code, `history.ts` and its OpenAPI entry are gone, and the tests read via the sync pull.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| L6  | Dead code reported by knip                              | this PR. The 3 unused UI files are deleted, and exports used only in their own file are dropped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| L7  | Validation limits duplicated as literals                | this PR. One constant per entry limit on the API, and a test holds the web copies equal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| L8  | Redundant `Production build` CI job                     | open: the owner has not decided whether to drop the `Production build` job and its required check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| L9  | Migrator sets no `lock_timeout`                         | this PR. The migration session has a 10 s `lock_timeout`, documented in `docs/operations.md`. Confirming the deploy container timeline is still an owner observation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| L10 | Empty and stale knowledge files                         | this PR. The `Session` entry has its two missing columns, and the empty template files point at the real content.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| L11 | Compatibility path for pre-transfer clients             | owner/accepted: keep the pre-transfer compatibility path. Removal is recommended on or after 2026-11-17 (30 days after #113 shipped).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| L12 | Local store re-reads the whole database on every commit | owner/accepted: no action now. Revisit if one history passes about 20k rows, or a phone shows commit latency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| L13 | `common` imports from `database`                        | owner/accepted: cosmetic edge, kept as is.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
