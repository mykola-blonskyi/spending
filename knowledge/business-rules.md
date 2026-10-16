# Business Rules

Rules are numbered so code, tests and PRs can cite them (`BR-n`).

## Access

- **BR-1.** The server derives the actor from the session only. Client-supplied user IDs, roles
  and scopes are never trusted. Every workspace-scoped read or write first checks membership of
  the actor in that workspace.
- **BR-2.** A personal workspace is visible only to its owner. Family members never see each
  other's personal transactions, accounts, categories, budgets, rules or imports. This holds on
  every path: list, search, analytics, export and sync.
- **BR-3.** A family transaction may reference an account in the family workspace or an account in
  its author's personal workspace. Viewers who cannot access that account see `account: null`
  and the author's display name instead. When such a viewer edits the row and sends the null back,
  the author's account is kept. An archived account stays allowed only on a row that already
  references it.
- **BR-4.** A transaction's category must belong to the transaction's workspace and match its kind.
  The service layer enforces it, because family deletion (BR-11) moves rows between workspaces. An
  archived category stays allowed only on a row that already uses it.
- **BR-5.** A user with no session gets `401 AUTH_REQUIRED`. A session whose provider grant was
  revoked is destroyed, and the next request gets `401 SESSION_REVOKED`.
- **BR-34.** Offline, the app opens on the local data of the user who last signed in on this
  device, until that user signs out or a `401` is seen; an explicit sign-out removes that data.
  When a different user signs in, the previous user's local data, unsent changes included, is
  deleted before theirs opens.

## Family

- **BR-6.** Family mode is optional. A user belongs to at most one family workspace.
- **BR-7.** Only the owner creates and revokes invitations, removes members, renames, transfers
  or deletes the family. Any member may add, edit or delete family transactions.
- **BR-8.** An invitation is single-use, bound to one workspace, expires (7 days by default,
  1 to 30 allowed) and can be revoked. Accepting needs a signed-in, approved account with a
  grant for this app; the provider's gate guarantees that. A user who already has a family cannot
  accept (`409 FAMILY_EXISTS`), and the invitation stays pending. An unknown, used, revoked or
  expired invitation fails with the same `410 INVITATION_INVALID`, so the endpoint is no oracle.
  Only the token's SHA-256 is stored; the raw link is shown once. Previewing a link shows the family and owner names only
  while it is pending; every other state answers the same `410`.
- **BR-9.** When a member leaves or is removed, the family transactions they authored stay in the
  family with their authorship intact. Their personal data is untouched. Their open sync conflicts
  on family transactions are dropped.
- **BR-10.** The owner cannot leave or remove themselves (`409 OWNER_CANNOT_LEAVE`). They
  transfer ownership to a current member or delete the family. Non-owners get `403 FORBIDDEN` on
  owner actions; ids outside the actor's own family get `404 NOT_FOUND`.
- **BR-11.** Deleting a family requires typing its name. Each family transaction moves to its
  author's personal workspace. Its category is re-linked to the author's personal category with
  the same name and kind, created if missing. A family account reference becomes null. A
  transaction whose author has deleted their account is deleted along with the family. Budgets,
  recurring rules and invitations of the family are deleted. Tombstones move too (with a category
  only when the author already has a matching one), and open conflicts of non-authors on moved
  rows are dropped. A wrong name fails with `400 CONFIRMATION_MISMATCH`.
- **BR-12.** In family mode, every new transaction explicitly chooses personal or family. Personal
  is preselected.

## Money and currency

- **BR-13.** Amounts are positive integers of minor units, at most 10^12 (`400 VALIDATION_FAILED`
  above it), so sums and conversions stay safe integers. The sign comes from `kind`. The
  minor-unit exponent comes from ISO 4217 (EUR 2, JPY 0, KWD 3).
- **BR-14.** EUR is the base currency. A non-EUR transaction stores the ECB rate of its
  `occurredOn` date, or of the latest earlier published date within 7 days, together with the
  rate date and source. Without a rate, `baseAmountMinor` stays null. A background job fills it
  when the rate arrives. The same job moves a row converted with an earlier day's rate onto a closer
  day's rate once it is published (a transaction entered before the ECB's afternoon release).
- **BR-15.** Analytics sum `baseAmountMinor`. Transactions with no conversion are reported in a
  separate "not converted" list per currency, never silently dropped or counted at 1:1.
  Analytics count only confirmed, non-deleted rows of the actor's workspaces in the chosen scope
  (personal, family or both). The comparison period is the previous calendar month for exactly one
  calendar month, the previous calendar year for exactly one calendar year, otherwise the
  equal-length period right before. Categories are never merged across scopes: same-named personal
  and family categories stay separate rows in "all".

## Ledger, history and sync

- **BR-16.** Deleting a transaction writes a tombstone. Tombstones are excluded from every read
  except sync pull.
- **BR-17.** Every write increments `version` and takes a new global `revision`. Sync pull returns
  rows with `revision > cursor` that the actor may see, plus the actor's current workspace list.
  The client drops local rows of workspaces it no longer belongs to; its pending changes there
  are shown as failed with no access, never dropped silently.
- **BR-18.** A sync mutation is applied at most once, keyed by its client mutation ID. A replay
  returns the stored outcome with the row's current view. A mutation ID already used by another
  user is rejected (`MUTATION_ID_REUSED`). A create (`baseVersion: null`) whose transaction ID
  already exists is treated as an update with an unknown base: applied when nothing would change,
  otherwise a conflict (BR-19).
- **BR-18a.** Personal rows are writable only by their workspace's owner; family rows by any
  member. Only the author moves a row between their personal workspace and the family; the other
  members then receive a tombstone for it. A row the
  actor cannot see is `NOT_FOUND`, never `FORBIDDEN`. Pending-review rows cannot be edited or
  deleted through sync (`REVIEW_REQUIRED`).
- **BR-19.** An update or delete whose `baseVersion` differs from the server's `version` creates
  a SyncConflict, unless the intended result equals the current server state. Deleting a row that
  is already deleted succeeds. A user has at most one open conflict per transaction; a newer stale
  edit replaces its local side. The server row is
  left unchanged. Totals count only the server row while the conflict is open. The conflict is
  shown to the user who made the edit.
- **BR-20.** Resolving a conflict applies the chosen version (server, local or a merge of fields)
  as a normal write and closes the conflict. Resolving it again is a no-op.
- **BR-35.** Restoring the server from a backup must not leave devices out of step. The restore
  bumps the revision sequence past every cursor a device can hold and changes the dataset epoch.
  A device that pulls a new epoch drops its cached server data and resyncs from the start. Its
  unsent changes are kept and sent again.
- **BR-21.** Pending-review transactions are excluded from history, totals and budgets until they
  are confirmed.

## Budgets and recurring

- **BR-22.** A budget is a monthly EUR limit on one expense category. Progress is the sum of
  confirmed expense `baseAmountMinor` in that category for the calendar month, in the user's
  timezone. `occurredOn` is a date, so the timezone only picks the current month. Unconverted
  expenses are listed per currency beside the progress and never count (BR-15). The status is
  `near` from 80% of the limit and `over` above it; spending exactly the limit is `near`. The
  category must be an active expense category of the budget's workspace (`422 INVALID_CATEGORY`).
  Any member of the workspace may set or delete its budgets.
- **BR-23.** Recurring generation is idempotent: `(recurringRuleId, recurringOccurrence)` is
  unique. The generator creates every missed occurrence up to today in the rule's timezone. A
  monthly rule anchored on the 29th to 31st clamps to the last day of shorter months. Deleting a
  generated transaction leaves its tombstone in place, so that occurrence is not regenerated.
- **BR-24.** Editing a rule affects only future occurrences: occurrences already due are generated
  with the old template first, then the next occurrence is recomputed from the later of today and
  the current next one. Occurrences while a rule is paused are skipped, not caught up on resume.
  Deleting a rule keeps the transactions it already generated. A rule's template follows the
  transaction reference rules (BR-3, BR-4), with the rule's creator as the author, and generated
  transactions are authored by the creator.
- **BR-33.** A rule with a backdated `startsOn` generates every past occurrence from that date,
  at most 1000 per generator run, so a long backlog completes over several runs; an edit first
  generates the whole backlog with the old template (BR-24). A rule keeps generating into an
  account or category it already references after that is archived; archiving only hides it from
  lists and pickers. A family rule keeps generating after its creator leaves the family; the
  creator stays the author.
  Resuming a paused rule skips the occurrences missed meanwhile (BR-24); spending exactly at a
  budget limit is `near`, not `over` (BR-22).

## Imports

- **BR-25.** Bank data is read-only. The product never asks for or stores online-banking
  credentials and never initiates payments.
- **BR-26.** The CSV upload limit is 2 MiB and 5000 rows. The client shows a preview and column
  mapping before anything is written. The server re-validates every row and reports rejected rows
  with a reason code.
- **BR-27.** The dedupe key is the provider transaction ID when mapped. Otherwise it is
  SHA-256 of account, date, amount, currency, normalized description, and the ordinal of that
  identical tuple within the file. Re-importing the same statement adds nothing. Two identical
  purchases in one statement are both kept. The amount in the tuple is signed (income and expense
  differ); the description is NFKC-normalized, lowercased and whitespace-collapsed. A provider ID
  repeated within one file rejects the later rows (`DUPLICATE_IN_FILE_EXTERNAL_ID`).
- **BR-28.** For a user without a family, imported rows are confirmed immediately in the personal
  workspace and auto-categorized. For a user with a family, they are `pending_review` until the
  user confirms category and scope for each row. They wait in the importer's personal workspace
  with the personal category suggestion. Confirming moves a family row to the family workspace
  with its account kept (BR-3); the category must belong to the target workspace (BR-4). One
  confirmation request is all or nothing.
- **BR-29.** Auto-categorization first uses the user's learned CategoryRules (per merchant key),
  then built-in keyword rules for default categories, and otherwise leaves the category empty.
  Only categories of the row's kind qualify, and archived ones are skipped. Confirming or changing
  the category of an imported row (sync push or review confirmation) updates the learned rule of
  the row's workspace. The merchant key is the first three words of the stored description, folded
  to lowercase without accents, with dates, card masks, numbers and bank boilerplate ("compra",
  "tarjeta", "recibo") removed.
- **BR-30.** Undoing an import batch deletes (tombstones) its transactions that were not edited
  after import and clears their dedupe keys, so the same statement can be imported again. Edited
  ones are kept and reported. Deleting a single imported transaction keeps its key, so a
  re-import does not bring it back, even after an undo. A row counts as edited when its `version`
  is above 1 (any user-visible change, including review confirmation) or it left the personal
  workspace. Only the importer can undo; repeating an undo changes nothing. Undo reports the deleted
  and kept counts as they are when it runs, so a manual deletion made in between can change what
  a repeat reports.

## Data rights

- **BR-31.** Export contains everything the actor can see: personal data plus the family's shared
  data, never another member's personal data (BR-2). JSON is complete: profile, workspaces with
  members and role, accounts, categories, live transactions (confirmed, plus pending-review rows of
  the actor's personal workspace; no tombstones), budgets, recurring rules, the actor's own import
  batches and category rules, and the actor's open sync conflicts with their unsaved version. A
  family row or rule using another member's personal account shows `accountId: null` (BR-3). CSV holds confirmed transactions only, amounts in unsigned major units
  with "." as decimal separator; cells a spreadsheet would run as formulas get a leading `'`.
- **BR-32.** Deleting an account requires typing `DELETE MY DATA` (`400 CONFIRMATION_MISMATCH`
  otherwise). An owner of a family with other members must transfer ownership or delete the
  family first (`409 FAMILY_OWNER_MUST_TRANSFER`); a sole owner's family is deleted as in BR-11.
  Personal data is hard-deleted, with sessions, sync mutations and conflicts. Family transactions
  the user authored stay with `createdBy = null` and are shown as "former member". Provider
  refresh tokens are revoked best effort; a provider failure never blocks the deletion. Signing
  in again creates a new user with a fresh personal workspace.
