ALTER TABLE "campaign_entries" ADD COLUMN "quarantined" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "l2b_edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "status_edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "dissatisfied_until" date;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD COLUMN "status_note" text;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD COLUMN "no_reply_reset_at" timestamp with time zone;