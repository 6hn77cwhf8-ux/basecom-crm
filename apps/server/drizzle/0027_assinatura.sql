ALTER TABLE "users" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mobile" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "work_email" text;--> statement-breakpoint
-- Assinaturas enviadas pelo Leonardo a 19/11/2026 (cartões de visita); só se ainda não estiverem preenchidas.
UPDATE "users" SET "job_title" = 'Consultora Comercial', "mobile" = '931045933', "work_email" = 'angela@basecom.pt'
WHERE lower(translate("name", 'âÂ', 'aA')) LIKE 'angela dias%' AND "job_title" IS NULL AND "mobile" IS NULL;
--> statement-breakpoint
UPDATE "users" SET "job_title" = 'Diretor Comercial', "mobile" = '931045401', "work_email" = 'leonardo@basecom.pt'
WHERE lower("name") LIKE 'leonardo%rocha%' AND "job_title" IS NULL AND "mobile" IS NULL;
