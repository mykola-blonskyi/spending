import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * One global sequence shared by every synced table (BR-17). The `ledger_stamp` trigger
 * (migration 0001) assigns it under a transaction-scoped advisory lock, so revisions become
 * visible in commit order and a pull cursor can never skip a late-committing write.
 */
export const ledgerRevision = pgSequence('ledger_revision');

export const localeEnum = pgEnum('locale', ['en', 'uk', 'ru', 'es']);
export const themeEnum = pgEnum('theme', ['light', 'dark', 'system']);
export const layoutEnum = pgEnum('layout', [
  'calm',
  'cards',
  'soft',
  'journal',
  'bento',
  'split',
  'playful',
  'hybrid',
]);
export const paletteEnum = pgEnum('palette', ['emerald', 'rose', 'ocean', 'sand', 'graphite']);
export const workspaceKindEnum = pgEnum('workspace_kind', ['personal', 'family']);
export const memberRoleEnum = pgEnum('member_role', ['owner', 'member']);
export const accountKindEnum = pgEnum('account_kind', ['cash', 'bank', 'card', 'savings', 'other']);
export const entryKindEnum = pgEnum('entry_kind', ['income', 'expense']);
export const transactionSourceEnum = pgEnum('transaction_source', [
  'manual',
  'import',
  'recurring',
]);
export const reviewStatusEnum = pgEnum('review_status', ['confirmed', 'pending_review']);
export const conflictStatusEnum = pgEnum('conflict_status', ['open', 'resolved']);
export const conflictResolutionEnum = pgEnum('conflict_resolution', ['server', 'local', 'merged']);
export const frequencyEnum = pgEnum('frequency', ['daily', 'weekly', 'monthly', 'yearly']);
export const workspaceEventTypeEnum = pgEnum('workspace_event_type', [
  'family_created',
  'renamed',
  'invitation_created',
  'invitation_revoked',
  'member_joined',
  'member_left',
  'member_removed',
  'ownership_transferred',
]);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const tstz = (name: string) => timestamp(name, { withTimezone: true });
const minor = (name: string) => bigint(name, { mode: 'number' });
const revision = () =>
  bigint('revision', { mode: 'number' })
    .notNull()
    .default(sql`nextval('ledger_revision')`);
const currency = (name = 'currency') => text(name).notNull();
const currencyCheck = (column: string) => sql.raw(`${column} ~ '^[A-Z]{3}$'`);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  oidcSub: text('oidc_sub').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  locale: localeEnum('locale').notNull().default('en'),
  theme: themeEnum('theme').notNull().default('system'),
  layout: layoutEnum('layout').notNull().default('calm'),
  palette: paletteEnum('palette').notNull().default('emerald'),
  timezone: text('timezone').notNull().default('Europe/Madrid'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    // Rotation rewrites token_hash in place and keeps the old hash here for a short grace window,
    // so the OIDC grant data lives in exactly one row and concurrent requests never fork it.
    previousTokenHash: text('previous_token_hash'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    csrfToken: text('csrf_token').notNull(),
    refreshTokenEnc: text('refresh_token_enc'),
    idTokenEnc: text('id_token_enc'),
    grantCheckedAt: tstz('grant_checked_at').notNull().defaultNow(),
    createdAt: createdAt(),
    rotatedAt: tstz('rotated_at').notNull().defaultNow(),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at').notNull(),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
    uniqueIndex('sessions_previous_token_uq')
      .on(t.previousTokenHash)
      .where(sql`${t.previousTokenHash} is not null`),
  ],
);

export const loginAttempts = pgTable('login_attempts', {
  state: text('state').primaryKey(),
  nonce: text('nonce').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  // SHA-256 of the login cookie set on the browser that started this attempt (login CSRF guard).
  bindingHash: text('binding_hash').notNull(),
  returnTo: text('return_to').notNull(),
  expiresAt: tstz('expires_at').notNull(),
});

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: workspaceKindEnum('kind').notNull(),
    name: text('name').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('workspaces_id_kind_uq').on(t.id, t.kind)],
);

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: uuid('workspace_id').notNull(),
    workspaceKind: workspaceKindEnum('workspace_kind').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull(),
    joinedAt: tstz('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    foreignKey({
      columns: [t.workspaceId, t.workspaceKind],
      foreignColumns: [workspaces.id, workspaces.kind],
    }).onDelete('cascade'),
    // ADR-008: exactly one personal workspace and at most one family per user.
    uniqueIndex('memberships_one_personal_uq')
      .on(t.userId)
      .where(sql`${t.workspaceKind} = 'personal'`),
    uniqueIndex('memberships_one_family_uq')
      .on(t.userId)
      .where(sql`${t.workspaceKind} = 'family'`),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: tstz('expires_at').notNull(),
    acceptedAt: tstz('accepted_at'),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [index('invitations_workspace_idx').on(t.workspaceId)],
);

/** The family audit log shown to members. */
export const workspaceEvents = pgTable(
  'workspace_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    type: workspaceEventTypeEnum('type').notNull(),
    subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('workspace_events_workspace_idx').on(t.workspaceId, t.createdAt.desc())],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: accountKindEnum('kind').notNull(),
    currency: currency(),
    archivedAt: tstz('archived_at'),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('accounts_workspace_idx').on(t.workspaceId),
    uniqueIndex('accounts_name_uq').on(t.workspaceId, t.kind, t.name),
    index('accounts_revision_idx').on(t.revision),
    check('accounts_currency_ck', currencyCheck('currency')),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: entryKindEnum('kind').notNull(),
    color: text('color').notNull(),
    icon: text('icon').notNull(),
    systemKey: text('system_key'),
    archivedAt: tstz('archived_at'),
    revision: revision(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('categories_name_uq').on(t.workspaceId, t.kind, t.name),
    index('categories_revision_idx').on(t.revision),
  ],
);

export const recurringRules = pgTable(
  'recurring_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    kind: entryKindEnum('kind').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: currency(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    description: text('description').notNull().default(''),
    frequency: frequencyEnum('frequency').notNull(),
    interval: integer('interval').notNull().default(1),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }),
    timezone: text('timezone').notNull(),
    nextOccurrence: date('next_occurrence', { mode: 'string' }),
    pausedAt: tstz('paused_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('recurring_due_idx').on(t.nextOccurrence),
    check('recurring_amount_ck', sql`${t.amountMinor} > 0`),
    check('recurring_interval_ck', sql`${t.interval} between 1 and 366`),
    check('recurring_currency_ck', currencyCheck('currency')),
  ],
);

export const importBatches = pgTable('import_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  fileName: text('file_name').notNull(),
  mapping: jsonb('mapping').notNull(),
  rowCount: integer('row_count').notNull(),
  importedCount: integer('imported_count').notNull(),
  duplicateCount: integer('duplicate_count').notNull(),
  rejectedCount: integer('rejected_count').notNull(),
  rejected: jsonb('rejected').$type<{ line: number; reason: string }[]>().notNull(),
  createdAt: createdAt(),
  undoneAt: tstz('undone_at'),
});

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    kind: entryKindEnum('kind').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: currency(),
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    description: text('description').notNull().default(''),
    note: text('note').notNull().default(''),
    baseAmountMinor: minor('base_amount_minor'),
    fxRate: numeric('fx_rate', { precision: 20, scale: 10 }),
    fxRateDate: date('fx_rate_date', { mode: 'string' }),
    fxSource: text('fx_source'),
    source: transactionSourceEnum('source').notNull().default('manual'),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id, {
      onDelete: 'set null',
    }),
    importHash: text('import_hash'),
    externalId: text('external_id'),
    recurringRuleId: uuid('recurring_rule_id').references(() => recurringRules.id, {
      onDelete: 'set null',
    }),
    recurringOccurrence: date('recurring_occurrence', { mode: 'string' }),
    reviewStatus: reviewStatusEnum('review_status').notNull().default('confirmed'),
    version: integer('version').notNull().default(1),
    revision: revision(),
    deletedAt: tstz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('transactions_history_idx')
      .on(t.workspaceId, t.occurredOn.desc())
      .where(sql`${t.deletedAt} is null`),
    index('transactions_revision_idx').on(t.revision),
    index('transactions_category_idx').on(t.categoryId),
    index('transactions_account_idx').on(t.accountId),
    index('transactions_created_by_idx').on(t.createdBy),
    index('transactions_import_batch_idx').on(t.importBatchId),
    // The hash already includes the account id (BR-27), so it is unique on its own and survives
    // the row moving to the family workspace or the account being archived.
    uniqueIndex('transactions_import_hash_uq')
      .on(t.importHash)
      .where(sql`${t.importHash} is not null`),
    uniqueIndex('transactions_recurring_uq')
      .on(t.recurringRuleId, t.recurringOccurrence)
      .where(sql`${t.recurringRuleId} is not null`),
    check('transactions_amount_ck', sql`${t.amountMinor} > 0`),
    check('transactions_currency_ck', currencyCheck('currency')),
    check(
      'transactions_fx_ck',
      sql`(${t.baseAmountMinor} is null) = (${t.fxRate} is null and ${t.currency} <> 'EUR')`,
    ),
    check(
      'transactions_eur_base_ck',
      sql`${t.currency} <> 'EUR' or ${t.baseAmountMinor} = ${t.amountMinor}`,
    ),
    check('transactions_fx_rate_ck', sql`${t.fxRate} is null or ${t.fxRate} > 0`),
    check('transactions_version_ck', sql`${t.version} >= 1`),
  ],
);

export const syncMutations = pgTable(
  'sync_mutations',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    result: jsonb('result').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sync_mutations_created_idx').on(t.createdAt)],
);

export const syncConflicts = pgTable(
  'sync_conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    baseVersion: integer('base_version').notNull(),
    serverVersion: integer('server_version').notNull(),
    local: jsonb('local').notNull(),
    /** Unused (conflicts read the live row); drop once no rollback target writes it. */
    server: jsonb('server'),
    status: conflictStatusEnum('status').notNull().default('open'),
    resolution: conflictResolutionEnum('resolution'),
    createdAt: createdAt(),
    resolvedAt: tstz('resolved_at'),
  },
  (t) => [
    uniqueIndex('sync_conflicts_open_uq')
      .on(t.transactionId, t.userId)
      .where(sql`${t.status} = 'open'`),
    index('sync_conflicts_user_idx').on(t.userId, t.status),
  ],
);

/**
 * A transaction that left a workspace (BR-18a). Members of that workspace pull it as a tombstone
 * once, at the move's revision; later edits of the row elsewhere never touch it (BR-2). The row
 * lives on in another workspace, so `transaction_id` has no foreign key. `revision` comes from
 * the `sync_tombstone_stamp` trigger (migration 0005), under the ledger lock like every
 * synced table.
 */
export const syncTombstones = pgTable(
  'sync_tombstones',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id').notNull(),
    revision: revision(),
    deletedAt: tstz('deleted_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.transactionId] }),
    index('sync_tombstones_revision_idx').on(t.workspaceId, t.revision),
  ],
);

export const fxRates = pgTable(
  'fx_rates',
  {
    date: date('date', { mode: 'string' }).notNull(),
    currency: currency(),
    ratePerEur: numeric('rate_per_eur', { precision: 20, scale: 10 }).notNull(),
    source: text('source').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.currency, t.date] }),
    check('fx_rates_rate_ck', sql`${t.ratePerEur} > 0`),
  ],
);

export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    amountMinor: minor('amount_minor').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('budgets_category_uq').on(t.workspaceId, t.categoryId),
    check('budgets_amount_ck', sql`${t.amountMinor} > 0`),
  ],
);

export const categoryRules = pgTable(
  'category_rules',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    merchantKey: text('merchant_key').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.merchantKey] })],
);
