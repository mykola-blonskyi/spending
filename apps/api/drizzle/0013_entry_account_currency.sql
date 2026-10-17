-- BR-39: an entry with an account is in that account's currency. The app enforces it; this guard
-- refuses to migrate a database that already breaks it, since a CHECK cannot read another table.
DO $$
DECLARE mismatched int;
BEGIN
  SELECT count(*) INTO mismatched
    FROM transactions t JOIN accounts a ON a.id = t.account_id
   WHERE t.deleted_at IS NULL AND t.currency <> a.currency;
  IF mismatched > 0 THEN
    RAISE EXCEPTION '% live transactions differ from their account''s currency; resolve before migrating', mismatched;
  END IF;
END $$;
