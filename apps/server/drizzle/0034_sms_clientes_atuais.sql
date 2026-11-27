-- 27/11/2026: SMS «Tentámos ligar» por tipo de campanha — acrescenta a versão de Clientes atuais (editável em Configurações › Mensagens).
UPDATE "settings" SET "value" = jsonb_set("value", '{templates}', ("value"->'templates') || jsonb_build_array(jsonb_build_object(
  'id', 'tried_call_current', 'label', 'Tentámos ligar · Clientes atuais (1.º não atende)', 'active', true,
  'text', E'{saudacao}, {decisor}. Tentámos ligar-lhe da NOS Empresas sobre os serviços NOS da {empresa}.\n\nLigue-nos para este número quando lhe der jeito — são 2 minutos.\n\n{comercial} · {telemovel} · NOS Empresas')))
WHERE "key" = 'messages' AND "value" ? 'templates' AND NOT ("value"->'templates') @> '[{"id":"tried_call_current"}]'::jsonb;--> statement-breakpoint
UPDATE "settings" SET "value" = jsonb_set("value", '{templates}', (SELECT jsonb_agg(CASE WHEN t->>'id' = 'tried_call' AND t->>'label' = 'Tentámos ligar (1.º não atende)' THEN jsonb_set(t, '{label}', '"Tentámos ligar · Novos clientes (1.º não atende)"') ELSE t END) FROM jsonb_array_elements("value"->'templates') t))
WHERE "key" = 'messages' AND "value" ? 'templates';
