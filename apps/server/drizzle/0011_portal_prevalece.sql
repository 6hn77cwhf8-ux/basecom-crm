-- Teste 1, ponto 7: quando a folha e o «Estado no Portal» não cruzam, vale o portal NOS. Clientes em carteira não mudam.
INSERT INTO "company_notes" ("company_id", "kind", "text")
SELECT "id", 'note', CASE WHEN "account_type" = 'prospect' THEN 'Tipo de conta corrigido de Prospeto para Cliente pelo estado no portal NOS.' ELSE 'Tipo de conta corrigido de Cliente para Prospeto pelo estado no portal NOS.' END
FROM "companies"
WHERE ("account_type" = 'prospect' AND "portal_status" = 'CLIENTE') OR ("account_type" = 'client' AND "portal_status" = 'PROSPECT' AND "owner_id" IS NULL);
--> statement-breakpoint
UPDATE "companies" SET "account_type" = CASE WHEN "account_type" = 'prospect' THEN 'client'::account_type ELSE 'prospect'::account_type END, "updated_at" = now()
WHERE ("account_type" = 'prospect' AND "portal_status" = 'CLIENTE') OR ("account_type" = 'client' AND "portal_status" = 'PROSPECT' AND "owner_id" IS NULL);
