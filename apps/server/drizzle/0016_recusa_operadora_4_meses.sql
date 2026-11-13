-- Decisão de 13 nov: na recusa por outra operadora (fidelizado ou renovou) o contacto é 4 meses antes do fim da fidelização.
-- Só muda os motivos guardados que ainda tinham o valor antigo por omissão (6).
UPDATE "settings" SET "value" = jsonb_set("value", '{reasons}', (
  SELECT jsonb_agg(CASE WHEN r->>'effect' IN ('loyalty_end', 'new_contract') AND COALESCE((r->>'monthsBefore')::int, 6) = 6
    THEN (r - 'contractMonths') || '{"monthsBefore": 4}'::jsonb ELSE r END)
  FROM jsonb_array_elements("value"->'reasons') AS r))
WHERE "key" = 'catalogs' AND jsonb_typeof("value"->'reasons') = 'array';
