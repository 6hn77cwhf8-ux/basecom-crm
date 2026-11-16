ALTER TABLE "opportunities" ADD COLUMN "nos_op" text;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "op_code" text;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "work_kind" text;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;