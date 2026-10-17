ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_named_or_default_ck" CHECK ("categories"."name" is not null or "categories"."system_key" is not null);--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_family_named_ck" CHECK ("workspaces"."kind" = 'personal' or "workspaces"."name" is not null);--> statement-breakpoint
-- BR-37 transfer shape for every writer, direct SQL included: at most two live sides in one
-- workspace, two sides of opposite kinds, and an outside mark only on a side that stands alone.
-- Deferred to commit, so a writer's intermediate states (family purge, import undo) pass.
CREATE FUNCTION transaction_transfer_shape() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n int; spaces int; kinds int; any_outside boolean;
BEGIN
  IF NEW.transfer_id IS NULL OR NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
  SELECT count(*), count(DISTINCT workspace_id), count(DISTINCT kind), bool_or(transfer_outside)
    INTO n, spaces, kinds, any_outside
    FROM transactions WHERE transfer_id = NEW.transfer_id AND deleted_at IS NULL;
  IF n > 2 OR spaces > 1 OR (n = 2 AND (kinds < 2 OR any_outside)) THEN
    RAISE EXCEPTION 'invalid transfer %', NEW.transfer_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transactions_transfer_shape
  AFTER INSERT OR UPDATE OF transfer_id, transfer_outside, workspace_id, kind, deleted_at
  ON transactions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION transaction_transfer_shape();
