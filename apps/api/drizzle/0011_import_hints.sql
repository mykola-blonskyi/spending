CREATE TABLE "import_hints" (
	"transaction_id" uuid PRIMARY KEY NOT NULL,
	"bank_category" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_hints" ADD CONSTRAINT "import_hints_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;