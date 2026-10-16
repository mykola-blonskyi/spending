-- Database audit 2026-10-16. Every statement runs in the migrator's one transaction while the API
-- is stopped (docs/operations.md), so plain locking DDL is safe: CREATE INDEX CONCURRENTLY cannot
-- run in a transaction, and NOT VALID + VALIDATE would gain nothing under the same lock. Each
-- ADD CONSTRAINT checks the existing rows and fails the deploy on a violation.
CREATE TABLE "sync_epoch" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"epoch" uuid DEFAULT gen_random_uuid() NOT NULL,
	CONSTRAINT "sync_epoch_single_ck" CHECK ("sync_epoch"."id")
);
--> statement-breakpoint
INSERT INTO "sync_epoch" DEFAULT VALUES;
--> statement-breakpoint
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_amount_ck";--> statement-breakpoint
ALTER TABLE "recurring_rules" DROP CONSTRAINT "recurring_amount_ck";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_amount_ck";--> statement-breakpoint
DROP INDEX "accounts_workspace_idx";--> statement-breakpoint
CREATE INDEX "transactions_fx_pending_idx" ON "transactions" USING btree ("id") WHERE "transactions"."currency" <> 'EUR' and "transactions"."deleted_at" is null and ("transactions"."fx_rate_date" is null or "transactions"."fx_rate_date" < "transactions"."occurred_on");--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_amount_ck" CHECK (amount_minor between 1 and 1000000000000);--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_settled_once_ck" CHECK ("invitations"."accepted_at" is null or "invitations"."revoked_at" is null);--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_ends_after_start_ck" CHECK ("recurring_rules"."ends_on" is null or "recurring_rules"."ends_on" >= "recurring_rules"."starts_on");--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_amount_ck" CHECK (amount_minor between 1 and 1000000000000);--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolution_ck" CHECK (("sync_conflicts"."status" = 'resolved') = ("sync_conflicts"."resolution" is not null and "sync_conflicts"."resolved_at" is not null));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_ck" CHECK (amount_minor between 1 and 1000000000000);