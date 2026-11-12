ALTER TABLE "companies" ADD COLUMN "wallet_kind_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "dialer_campaign_id" uuid;--> statement-breakpoint
UPDATE "companies" SET "wallet_kind_confirmed" = true WHERE "owner_id" IS NOT NULL;
