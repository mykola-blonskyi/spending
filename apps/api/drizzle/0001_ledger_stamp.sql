-- Stamps every write to a synced table (BR-17, BR-19). The advisory lock serializes ledger
-- writers from their first write until commit, so revisions are assigned in commit order and a
-- sync pull cursor never skips a row committed later with a smaller revision.
CREATE FUNCTION ledger_stamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(7302001);
  NEW.revision := nextval('ledger_revision');
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- A transaction's version counts user-visible changes only, so a background FX fill does not
-- turn a concurrent offline edit into a conflict.
CREATE FUNCTION transaction_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.workspace_id, NEW.kind, NEW.amount_minor, NEW.currency, NEW.occurred_on, NEW.account_id,
      NEW.category_id, NEW.description, NEW.note, NEW.review_status, NEW.deleted_at)
     IS DISTINCT FROM
     (OLD.workspace_id, OLD.kind, OLD.amount_minor, OLD.currency, OLD.occurred_on, OLD.account_id,
      OLD.category_id, OLD.description, OLD.note, OLD.review_status, OLD.deleted_at) THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER accounts_stamp BEFORE INSERT OR UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION ledger_stamp();
--> statement-breakpoint
CREATE TRIGGER categories_stamp BEFORE INSERT OR UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION ledger_stamp();
--> statement-breakpoint
CREATE TRIGGER transactions_stamp BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_stamp();
--> statement-breakpoint
CREATE TRIGGER transactions_version BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION transaction_version();
