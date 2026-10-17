-- No backfill: an existing account has no opening balance (0, null date), which is also what a
-- device assumes for an account it cached before these columns, so no revision bump is needed.
ALTER TABLE "accounts" ADD COLUMN "opening_balance_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "opening_on" date;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_opening_balance_ck" CHECK (opening_balance_minor between -1000000000000 and 1000000000000);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_opening_on_ck" CHECK ((opening_balance_minor = 0) = (opening_on is null));