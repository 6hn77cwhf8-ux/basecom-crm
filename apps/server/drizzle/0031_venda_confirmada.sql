ALTER TABLE "opportunities" ADD COLUMN "sold_types" jsonb;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "sold_value" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "closed_via" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- 23/11/2026: novo motivo «Recusa à abordagem» (120 dias fora das campanhas), antes de «Outro», nos catálogos já guardados.
UPDATE "settings" SET "value" = jsonb_set("value", '{reasons}',
  (SELECT jsonb_agg(r ORDER BY (r->>'id' = 'other'), ord) FROM jsonb_array_elements(("value"->'reasons') || '[{"id":"approach","label":"Recusa à abordagem","effect":"cooldown","days":120,"active":true}]'::jsonb) WITH ORDINALITY AS x(r, ord)))
WHERE "key" = 'catalogs' AND "value" ? 'reasons' AND NOT ("value"->'reasons') @> '[{"id":"approach"}]'::jsonb;
