CREATE TABLE "wallet_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"from_owner_id" uuid,
	"to_owner_id" uuid,
	"kind" text NOT NULL,
	"effective_from" date NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "wallet_changes" ADD CONSTRAINT "wallet_changes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_changes" ADD CONSTRAINT "wallet_changes_from_owner_id_users_id_fk" FOREIGN KEY ("from_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_changes" ADD CONSTRAINT "wallet_changes_to_owner_id_users_id_fk" FOREIGN KEY ("to_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_changes" ADD CONSTRAINT "wallet_changes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_changes_company_idx" ON "wallet_changes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "wallet_changes_status_idx" ON "wallet_changes" USING btree ("status","effective_from");