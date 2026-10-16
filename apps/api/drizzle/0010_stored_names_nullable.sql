ALTER TABLE "categories" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
DO $$
DECLARE duplicates text;
BEGIN
  SELECT string_agg(workspace_id || ':' || system_key, ', ')
    INTO duplicates
    FROM (SELECT workspace_id, system_key FROM categories
           WHERE system_key IS NOT NULL
           GROUP BY workspace_id, system_key HAVING count(*) > 1) d;
  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'categories share a system_key within a workspace (%); resolve before migrating', duplicates;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "categories_system_key_uq" ON "categories" USING btree ("workspace_id","system_key") WHERE "categories"."system_key" is not null;--> statement-breakpoint
UPDATE "categories" c SET "name" = NULL
FROM (VALUES
  ('groceries', 'Groceries'), ('dining', 'Dining'), ('transport', 'Transport'),
  ('housing', 'Housing'), ('utilities', 'Utilities'), ('health', 'Health'),
  ('shopping', 'Shopping'), ('entertainment', 'Entertainment'), ('travel', 'Travel'),
  ('education', 'Education'), ('kids', 'Kids'), ('gifts', 'Gifts'),
  ('subscriptions', 'Subscriptions'), ('other_expense', 'Other'), ('salary', 'Salary'),
  ('freelance', 'Freelance'), ('gifts_received', 'Gifts received'), ('refunds', 'Refunds'),
  ('interest', 'Interest'), ('other_income', 'Other')
) AS d(system_key, english_name)
WHERE c."system_key" = d.system_key AND c."name" = d.english_name;--> statement-breakpoint
UPDATE "workspaces" SET "name" = NULL WHERE "kind" = 'personal' AND "name" = 'Personal';
