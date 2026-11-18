-- Correções de 18/11/2026 (dados): motivo «Insatisfeito NOS», modelo «Tentámos ligar» e callbacks antigos para a fila.
-- 1) Motivo de recusa «Insatisfeito NOS» (12 meses fora de todas as campanhas), se o catálogo já estiver guardado.
UPDATE "settings" SET "value" = jsonb_set("value", '{reasons}', ("value"->'reasons') || '[{"id":"dissatisfied","label":"Insatisfeito NOS","effect":"dissatisfied","months":12,"active":true}]'::jsonb)
WHERE "key" = 'catalogs' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("value"->'reasons') r WHERE r->>'id' = 'dissatisfied');
--> statement-breakpoint
-- 2) Modelo de mensagem «Tentámos ligar», se os modelos já estiverem guardados.
UPDATE "settings" SET "value" = jsonb_set("value", '{templates}', '[{"id":"tried_call","label":"Tentámos ligar (1.º não atende)","active":true,"text":"{saudacao}, {decisor}. Tentámos ligar-lhe da NOS Empresas sobre as comunicações da {empresa}.\n\nLigue-nos para este número quando lhe der jeito — são 2 minutos.\n\n{comercial} · NOS Empresas"}]'::jsonb || ("value"->'templates'))
WHERE "key" = 'messages' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("value"->'templates') t WHERE t->>'id' = 'tried_call');
--> statement-breakpoint
-- 3) Callbacks antigos (tarefas «Ligar» criadas por «Ligar mais tarde») saem da Agenda e voltam à fila do comercial.
INSERT INTO "campaigns" ("name", "mode", "status", "filters", "created_by")
SELECT 'Callbacks (automática)', 'new', 'active', '{"system":"callbacks"}'::jsonb, t."created_by"
FROM "tasks" t JOIN "calls" k ON k."id" = t."call_id"
WHERE t."status" = 'open' AND k."effect" = 'call_later' AND NOT EXISTS (SELECT 1 FROM "campaigns" WHERE "filters"->>'system' = 'callbacks')
LIMIT 1;
--> statement-breakpoint
WITH cb AS (
  SELECT DISTINCT ON (t."company_id") t."id", t."company_id", t."assigned_to", t."due_at", k."entry_id"
  FROM "tasks" t JOIN "calls" k ON k."id" = t."call_id"
  WHERE t."status" = 'open' AND k."effect" = 'call_later'
  ORDER BY t."company_id", t."due_at"
), upd AS (
  UPDATE "campaign_entries" e SET "assigned_to" = cb."assigned_to", "next_at" = cb."due_at", "last_outcome" = 'call_later', "status" = 'pending', "locked_by" = NULL, "locked_until" = NULL
  FROM cb WHERE e."id" = cb."entry_id"
  RETURNING cb."id"
)
INSERT INTO "campaign_entries" ("campaign_id", "company_id", "assigned_to", "next_at", "last_outcome")
SELECT (SELECT "id" FROM "campaigns" WHERE "filters"->>'system' = 'callbacks' LIMIT 1), cb."company_id", cb."assigned_to", cb."due_at", 'call_later'
FROM cb WHERE cb."entry_id" IS NULL OR NOT EXISTS (SELECT 1 FROM "campaign_entries" e WHERE e."id" = cb."entry_id");
--> statement-breakpoint
UPDATE "tasks" t SET "status" = 'done', "done_at" = now(), "description" = coalesce(t."description", '') || ' · passou para a fila de chamadas (18/11/2026)'
FROM "calls" k WHERE k."id" = t."call_id" AND t."status" = 'open' AND k."effect" = 'call_later';
