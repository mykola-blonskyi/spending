ALTER TABLE "transactions" ADD COLUMN "transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "transfer_outside" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "transactions_transfer_idx" ON "transactions" USING btree ("transfer_id") WHERE "transactions"."transfer_id" is not null;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_ck" CHECK ("transactions"."transfer_id" is null and not "transactions"."transfer_outside" or "transactions"."transfer_id" is not null and "transactions"."category_id" is null);--> statement-breakpoint
-- Marking or unmarking a transfer is a user-visible change, so it takes a version like any edit.
CREATE OR REPLACE FUNCTION transaction_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.workspace_id, NEW.kind, NEW.amount_minor, NEW.currency, NEW.occurred_on, NEW.account_id,
      NEW.category_id, NEW.description, NEW.note, NEW.review_status, NEW.deleted_at,
      NEW.transfer_id, NEW.transfer_outside)
     IS DISTINCT FROM
     (OLD.workspace_id, OLD.kind, OLD.amount_minor, OLD.currency, OLD.occurred_on, OLD.account_id,
      OLD.category_id, OLD.description, OLD.note, OLD.review_status, OLD.deleted_at,
      OLD.transfer_id, OLD.transfer_outside) THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END;
$$;
