-- SMS «Tentámos ligar» (19/11/2026): termina com «nome · telemóvel · NOS Empresas». Só muda se o texto ainda for o original.
UPDATE "settings" SET "value" = jsonb_set("value", '{templates}', (
  SELECT jsonb_agg(CASE WHEN t->>'id' = 'tried_call' AND t->>'text' LIKE '%{comercial} · NOS Empresas'
    THEN jsonb_set(t, '{text}', to_jsonb(replace(t->>'text', '{comercial} · NOS Empresas', '{comercial} · {telemovel} · NOS Empresas'))) ELSE t END)
  FROM jsonb_array_elements("value"->'templates') t))
WHERE "key" = 'messages';
