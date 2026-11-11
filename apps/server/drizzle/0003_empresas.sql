CREATE TYPE "public"."account_type" AS ENUM('client', 'prospect');--> statement-breakpoint
CREATE TYPE "public"."wallet_kind" AS ENUM('NC', 'FC');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nif" text NOT NULL,
	"nif_valid" boolean DEFAULT true NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"account_type" "account_type" NOT NULL,
	"size" text,
	"employees_band" text,
	"l2b_monthly" numeric(12, 2),
	"loyalty_end" date,
	"address" text,
	"postal_code" text,
	"locality" text,
	"municipality" text,
	"operator" text,
	"economic_group" text,
	"owner_id" uuid,
	"wallet_kind" "wallet_kind" DEFAULT 'NC' NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"needs_review" text,
	"last_source_year" integer,
	"sources" text,
	"batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_nif_unique" UNIQUE("nif")
);
--> statement-breakpoint
CREATE TABLE "company_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"phone_type" text,
	"person_name" text,
	"salutation" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'valid' NOT NULL,
	"batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"user_id" uuid,
	"batch_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"file_data" "bytea" NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"options" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"reverted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"sheet" text NOT NULL,
	"row_number" integer NOT NULL,
	"nif" text,
	"name" text,
	"result" text NOT NULL,
	"detail" text,
	"data" jsonb NOT NULL,
	"before" jsonb,
	"company_id" uuid
);
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_notes" ADD CONSTRAINT "company_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_notes" ADD CONSTRAINT "company_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_notes" ADD CONSTRAINT "company_notes_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_name_key_idx" ON "companies" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "companies_owner_idx" ON "companies" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "companies_postal_idx" ON "companies" USING btree ("postal_code");--> statement-breakpoint
CREATE INDEX "company_contacts_value_idx" ON "company_contacts" USING btree ("value");--> statement-breakpoint
CREATE INDEX "company_contacts_company_idx" ON "company_contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_notes_company_idx" ON "company_notes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "import_rows_batch_idx" ON "import_rows" USING btree ("batch_id");