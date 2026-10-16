-- Run on a restored database before it goes live (docs/operations.md, Backups and restore).
BEGIN;

-- A dump carries ledger_revision as of the dump. Devices hold cursors past it and would skip every
-- new write until the sequence caught up, so jump far beyond anything they can have seen.
SELECT setval('ledger_revision', greatest(
  (SELECT coalesce(max(revision), 0) FROM accounts),
  (SELECT coalesce(max(revision), 0) FROM categories),
  (SELECT coalesce(max(revision), 0) FROM transactions),
  (SELECT coalesce(max(revision), 0) FROM sync_tombstones)
) + 1000000000);

-- Devices also hold rows this dump lost. A new epoch makes each one drop its server rows and pull
-- from 0 (BR-35). A dump older than migration 0009 has no table; the migration then creates a
-- fresh epoch on redeploy.
DO $$
BEGIN
  IF to_regclass('sync_epoch') IS NOT NULL THEN
    UPDATE sync_epoch SET epoch = gen_random_uuid();
  END IF;
END $$;

COMMIT;
