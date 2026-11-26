-- 26/11/2026: empresas recusadas voltavam a cair. Limpa as filas de quem está em prazo de recusa, «Não contactar»,
-- encerrada ou Insatisfeito NOS, e as tarefas de vendas de oportunidades já fechadas (Ganha/Perdida).
UPDATE "campaign_entries" e SET "status" = 'removed', "locked_by" = NULL, "locked_until" = NULL
FROM "companies" c
WHERE c."id" = e."company_id" AND e."status" = 'pending'
  AND (c."do_not_contact" OR c."inactive"
    OR (c."campaign_eligible_from" IS NOT NULL AND c."campaign_eligible_from" > current_date)
    OR (c."dissatisfied_until" IS NOT NULL AND c."dissatisfied_until" > current_date));--> statement-breakpoint
UPDATE "tasks" t SET "status" = 'cancelled', "done_at" = now()
FROM "opportunities" o
WHERE o."id" = t."opportunity_id" AND t."status" = 'open' AND o."stage" IN ('won', 'lost');
