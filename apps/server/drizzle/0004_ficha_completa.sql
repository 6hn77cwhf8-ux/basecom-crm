ALTER TABLE "companies" ADD COLUMN "district" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "sector" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "annual_revenue" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "locations_potential" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "rgu" jsonb;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "product" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "technology" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "loyalty_months" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "portal_status" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "nos_exit_month" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "nbo_campaign" text;--> statement-breakpoint
CREATE INDEX "companies_district_idx" ON "companies" USING btree ("district");--> statement-breakpoint
CREATE INDEX "companies_sector_idx" ON "companies" USING btree ("sector");