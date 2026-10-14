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
  and the author's display name instead.
- **BR-4.** A transaction's category must belong to the transaction's workspace and match its kind.
  The service layer enforces it, because family deletion (BR-11) moves rows between workspaces.
- **BR-5.** A user with no session gets `401 AUTH_REQUIRED`. A session whose provider grant was
  revoked is destroyed, and the next request gets `401 SESSION_REVOKED`.

## Family

- **BR-6.** Family mode is optional. A user belongs to at most one family workspace.
- **BR-7.** Only the owner creates and revokes invitations, removes members, renames, transfers
  or deletes the family.
- **BR-8.** An invitation is single-use, bound to one workspace, expires (7 days by default,
  1 to 30 allowed) and can be revoked. Accepting needs a signed-in, approved account with a
  grant for this app; the provider's gate guarantees that. A user who already has a family cannot
  accept.
- **BR-9.** When a member leaves or is removed, the family transactions they authored stay in the
  family with their authorship intact. Their personal data is untouched.
- **BR-10.** The owner cannot leave. They transfer ownership or delete the family.
- **BR-11.** Deleting a family requires typing its name. Each family transaction moves to its
  author's personal workspace. Its category is re-linked to the author's personal category with
  the same name and kind, created if missing. A family account reference becomes null. A
  transaction whose author has deleted their account is deleted along with the family. Budgets,
  recurring rules and invitations of the family are deleted.
- **BR-12.** In family mode, every new transaction explicitly chooses personal or family. Personal
  is preselected.

## Money and currency

- **BR-13.** Amounts are positive integers of minor units. The sign comes from `kind`. The
  minor-unit exponent comes from ISO 4217 (EUR 2, JPY 0, KWD 3).
- **BR-14.** EUR is the base currency. A non-EUR transaction stores the ECB rate of its
  `occurredOn` date, or of the latest earlier published date within 7 days, together with the
  rate date and source. Without a rate, `baseAmountMinor` stays null. A background job fills it
  when the rate arrives.
- **BR-15.** Analytics sum `baseAmountMinor`. Transactions with no conversion are reported in a
  separate "not converted" list per currency, never silently dropped or counted at 1:1.

## Ledger, history and sync

- **BR-16.** Deleting a transaction writes a tombstone. Tombstones are excluded from every read
  except sync pull.
- **BR-17.** Every write increments `version` and takes a new global `revision`. Sync pull returns
  rows with `revision > cursor` that the actor may see, plus the actor's current workspace list.
  The client drops local rows of workspaces it no longer belongs to.
- **BR-18.** A sync mutation is applied at most once, keyed by its client mutation ID. A create
  with an existing transaction ID made by the same actor is treated as an update.
- **BR-19.** An update or delete whose `baseVersion` differs from the server's `version` creates
  a SyncConflict, unless the intended result equals the current server state. The server row is
  left unchanged. Totals count only the server row while the conflict is open. The conflict is
  shown to the user who made the edit.
- **BR-20.** Resolving a conflict applies the chosen version (server, local or a merge of fields)
  as a normal write and closes the conflict. Resolving it again is a no-op.
- **BR-21.** Pending-review transactions are excluded from history, totals and budgets until they
  are confirmed.

## Budgets and recurring

- **BR-22.** A budget is a monthly EUR limit on one expense category. Progress is the sum of
  confirmed expense `baseAmountMinor` in that category for the calendar month, in the user's
  timezone.
- **BR-23.** Recurring generation is idempotent: `(recurringRuleId, recurringOccurrence)` is
  unique. The generator creates every missed occurrence up to today in the rule's timezone. A
  monthly rule anchored on the 29th to 31st clamps to the last day of shorter months. Deleting a
  generated transaction leaves its tombstone in place, so that occurrence is not regenerated.
- **BR-24.** Editing a rule affects only future occurrences. Deleting a rule keeps the
  transactions it already generated.

## Imports

- **BR-25.** Bank data is read-only. The product never asks for or stores online-banking
  credentials and never initiates payments.
- **BR-26.** The CSV upload limit is 2 MiB and 5000 rows. The client shows a preview and column
  mapping before anything is written. The server re-validates every row and reports rejected rows
  with a reason code.
- **BR-27.** The dedupe key is the provider transaction ID when mapped. Otherwise it is
  SHA-256 of account, date, amount, currency, normalized description, and the ordinal of that
  identical tuple within the file. Re-importing the same statement adds nothing. Two identical
  purchases in one statement are both kept.
- **BR-28.** For a user without a family, imported rows are confirmed immediately in the personal
  workspace and auto-categorized. For a user with a family, they are `pending_review` until the
  user confirms category and scope for each row.
- **BR-29.** Auto-categorization first uses the user's learned CategoryRules (per merchant key),
  then built-in keyword rules for default categories, and otherwise leaves the category empty.
  Confirming or changing the category of an imported row updates the learned rule.
- **BR-30.** Undoing an import batch deletes (tombstones) its transactions that were not edited
  after import and clears their dedupe keys, so the same statement can be imported again. Edited
  ones are kept and reported. Deleting a single imported transaction keeps its key, so a
  re-import does not bring it back.

## Data rights

- **BR-31.** Export contains everything the actor can see: personal data plus the family's shared
  data. It comes as JSON (complete) and CSV (transactions).
- **BR-32.** Deleting an account requires typing a confirmation phrase. An owner of a family with
  other members must transfer ownership or delete the family first (`409 FAMILY_OWNER_MUST_TRANSFER`).
  Personal data is hard-deleted. Family transactions the user authored stay with `createdBy = null`
  and are shown as "former member".
