ALTER TABLE "sessions" ADD COLUMN "previous_token_hash" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "rotated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_previous_token_uq" ON "sessions" USING btree ("previous_token_hash") WHERE "sessions"."previous_token_hash" is not null;