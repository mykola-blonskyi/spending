ALTER TABLE "accounts" ADD COLUMN "opening_balance_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "opening_on" date DEFAULT current_date NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_opening_balance_ck" CHECK (opening_balance_minor between -1000000000000 and 1000000000000);--> statement-breakpoint
-- An existing account opens on its creation day. Touching every row also bumps its revision, so
-- each device pulls its accounts again with the new fields.
UPDATE "accounts" SET "opening_on" = ("created_at" AT TIME ZONE 'UTC')::date;
