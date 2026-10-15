DROP INDEX "sync_mutations_created_idx";--> statement-breakpoint
ALTER TABLE "sync_conflicts" ALTER COLUMN "server" DROP NOT NULL;