CREATE TYPE "public"."account_kind" AS ENUM('cash', 'bank', 'card', 'savings', 'other');--> statement-breakpoint
CREATE TYPE "public"."conflict_resolution" AS ENUM('server', 'local', 'merged');--> statement-breakpoint
CREATE TYPE "public"."conflict_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."entry_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."frequency" AS ENUM('daily', 'weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('en', 'uk', 'ru', 'es');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('confirmed', 'pending_review');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('light', 'dark', 'system');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('manual', 'import', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."workspace_kind" AS ENUM('personal', 'family');--> statement-breakpoint
CREATE SEQUENCE "public"."ledger_revision" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "account_kind" NOT NULL,
	"currency" text NOT NULL,
	"archived_at" timestamp with time zone,
	"revision" bigint DEFAULT nextval('ledger_revision') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_currency_ck" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_amount_ck" CHECK ("budgets"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "entry_kind" NOT NULL,
	"color" text NOT NULL,
	"icon" text NOT NULL,
	"system_key" text,
	"archived_at" timestamp with time zone,
	"revision" bigint DEFAULT nextval('ledger_revision') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_rules" (
	"workspace_id" uuid NOT NULL,
	"merchant_key" text NOT NULL,
	"category_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_rules_workspace_id_merchant_key_pk" PRIMARY KEY("workspace_id","merchant_key")
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"date" date NOT NULL,
	"currency" text NOT NULL,
	"rate_per_eur" numeric(20, 10) NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "fx_rates_currency_date_pk" PRIMARY KEY("currency","date"),
	CONSTRAINT "fx_rates_rate_ck" CHECK ("fx_rates"."rate_per_eur" > 0)
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid,
	"file_name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"imported_count" integer NOT NULL,
	"duplicate_count" integer NOT NULL,
	"rejected_count" integer NOT NULL,
	"rejected" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"state" text PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL,
	"code_verifier" text NOT NULL,
	"return_to" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" uuid NOT NULL,
	"workspace_kind" "workspace_kind" NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid,
	"kind" "entry_kind" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"account_id" uuid,
	"category_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"frequency" "frequency" NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"timezone" text NOT NULL,
	"next_occurrence" date,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_amount_ck" CHECK ("recurring_rules"."amount_minor" > 0),
	CONSTRAINT "recurring_interval_ck" CHECK ("recurring_rules"."interval" between 1 and 366),
	CONSTRAINT "recurring_currency_ck" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"csrf_token" text NOT NULL,
	"refresh_token_enc" text,
	"id_token_enc" text,
	"grant_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"base_version" integer NOT NULL,
	"server_version" integer NOT NULL,
	"local" jsonb NOT NULL,
	"server" jsonb NOT NULL,
	"status" "conflict_status" DEFAULT 'open' NOT NULL,
	"resolution" "conflict_resolution",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_mutations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid,
	"kind" "entry_kind" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"occurred_on" date NOT NULL,
	"account_id" uuid,
	"category_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"base_amount_minor" bigint,
	"fx_rate" numeric(20, 10),
	"fx_rate_date" date,
	"fx_source" text,
	"source" "transaction_source" DEFAULT 'manual' NOT NULL,
	"import_batch_id" uuid,
	"import_hash" text,
	"external_id" text,
	"recurring_rule_id" uuid,
	"recurring_occurrence" date,
	"review_status" "review_status" DEFAULT 'confirmed' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"revision" bigint DEFAULT nextval('ledger_revision') NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_ck" CHECK ("transactions"."amount_minor" > 0),
	CONSTRAINT "transactions_currency_ck" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "transactions_fx_ck" CHECK (("transactions"."base_amount_minor" is null) = ("transactions"."fx_rate" is null and "transactions"."currency" <> 'EUR')),
	CONSTRAINT "transactions_eur_base_ck" CHECK ("transactions"."currency" <> 'EUR' or "transactions"."base_amount_minor" = "transactions"."amount_minor"),
	CONSTRAINT "transactions_fx_rate_ck" CHECK ("transactions"."fx_rate" is null or "transactions"."fx_rate" > 0),
	CONSTRAINT "transactions_version_ck" CHECK ("transactions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oidc_sub" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"locale" "locale" DEFAULT 'en' NOT NULL,
	"theme" "theme" DEFAULT 'system' NOT NULL,
	"timezone" text DEFAULT 'Europe/Madrid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_oidc_sub_unique" UNIQUE("oidc_sub")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "workspace_kind" NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_id_kind_uq" UNIQUE("id","kind")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspace_kind_workspaces_id_kind_fk" FOREIGN KEY ("workspace_id","workspace_kind") REFERENCES "public"."workspaces"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_mutations" ADD CONSTRAINT "sync_mutations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_rule_id_recurring_rules_id_fk" FOREIGN KEY ("recurring_rule_id") REFERENCES "public"."recurring_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_workspace_idx" ON "accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "accounts_revision_idx" ON "accounts" USING btree ("revision");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_category_uq" ON "budgets" USING btree ("workspace_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_uq" ON "categories" USING btree ("workspace_id","kind","name");--> statement-breakpoint
CREATE INDEX "categories_revision_idx" ON "categories" USING btree ("revision");--> statement-breakpoint
CREATE INDEX "invitations_workspace_idx" ON "invitations" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_personal_uq" ON "memberships" USING btree ("user_id") WHERE "memberships"."workspace_kind" = 'personal';--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_family_uq" ON "memberships" USING btree ("user_id") WHERE "memberships"."workspace_kind" = 'family';--> statement-breakpoint
CREATE INDEX "recurring_due_idx" ON "recurring_rules" USING btree ("next_occurrence");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_conflicts_open_uq" ON "sync_conflicts" USING btree ("transaction_id","user_id") WHERE "sync_conflicts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "sync_conflicts_user_idx" ON "sync_conflicts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "sync_mutations_created_idx" ON "sync_mutations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "transactions_history_idx" ON "transactions" USING btree ("workspace_id","occurred_on" DESC NULLS LAST) WHERE "transactions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "transactions_revision_idx" ON "transactions" USING btree ("revision");--> statement-breakpoint
CREATE INDEX "transactions_category_idx" ON "transactions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transactions_account_idx" ON "transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "transactions_created_by_idx" ON "transactions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "transactions_import_batch_idx" ON "transactions" USING btree ("import_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_import_hash_uq" ON "transactions" USING btree ("import_hash") WHERE "transactions"."import_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_recurring_uq" ON "transactions" USING btree ("recurring_rule_id","recurring_occurrence") WHERE "transactions"."recurring_rule_id" is not null;