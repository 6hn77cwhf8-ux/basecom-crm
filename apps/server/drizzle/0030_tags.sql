ALTER TABLE "companies" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "companies_tags_idx" ON "companies" USING gin ("tags");