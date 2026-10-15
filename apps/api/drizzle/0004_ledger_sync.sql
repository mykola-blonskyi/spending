CREATE TABLE "sync_tombstones" (
	"workspace_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"revision" bigint DEFAULT nextval('ledger_revision') NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_tombstones_workspace_id_transaction_id_pk" PRIMARY KEY("workspace_id","transaction_id")
);
--> statement-breakpoint
ALTER TABLE "sync_tombstones" ADD CONSTRAINT "sync_tombstones_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_tombstones_revision_idx" ON "sync_tombstones" USING btree ("workspace_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_name_uq" ON "accounts" USING btree ("workspace_id","kind","name");--> statement-breakpoint
-- Same lock and sequence as ledger_stamp (0001), so a tombstone's revision is in commit order
-- with every other synced row. A repeated move upserts the row and takes a fresh revision.
CREATE FUNCTION sync_tombstone_stamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(7302001);
  NEW.revision := nextval('ledger_revision');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sync_tombstones_stamp BEFORE INSERT OR UPDATE ON sync_tombstones
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone_stamp();
