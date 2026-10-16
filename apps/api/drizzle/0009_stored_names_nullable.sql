ALTER TABLE "categories" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
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
