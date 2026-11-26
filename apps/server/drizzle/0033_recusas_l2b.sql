-- 25/11/2026: novos motivos «Tem gestor» (120 dias) e «Fidelizado recentemente (NOS)» (contacto 8 meses depois do início), antes de «Outro».
UPDATE "settings" SET "value" = jsonb_set("value", '{reasons}',
  (SELECT jsonb_agg(r ORDER BY (r->>'id' = 'other'), ord) FROM jsonb_array_elements(("value"->'reasons') || '[{"id":"manager","label":"Tem gestor","effect":"cooldown","days":120,"active":true}]'::jsonb) WITH ORDINALITY AS x(r, ord)))
WHERE "key" = 'catalogs' AND "value" ? 'reasons' AND NOT ("value"->'reasons') @> '[{"id":"manager"}]'::jsonb;--> statement-breakpoint
UPDATE "settings" SET "value" = jsonb_set("value", '{reasons}',
  (SELECT jsonb_agg(r ORDER BY (r->>'id' = 'other'), ord) FROM jsonb_array_elements(("value"->'reasons') || '[{"id":"recent_nos","label":"Fidelizado recentemente (NOS)","effect":"recent_nos","contactAfterMonths":8,"active":true}]'::jsonb) WITH ORDINALITY AS x(r, ord)))
WHERE "key" = 'catalogs' AND "value" ? 'reasons' AND NOT ("value"->'reasons') @> '[{"id":"recent_nos"}]'::jsonb;
