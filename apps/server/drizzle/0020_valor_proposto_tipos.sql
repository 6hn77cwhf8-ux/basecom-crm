ALTER TABLE "opportunities" ADD COLUMN "sale_types" jsonb;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "proposed_value" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "opportunities" SET "stage_changed_at" = "last_activity_at";
