ALTER TABLE "phone_commands" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "phone_commands" ADD CONSTRAINT "phone_commands_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- 20/11/2026: o Administrador é a empresa («Incognit Truth, Unipessoal Lda»), não o Leonardo; o Leonardo tem login próprio de Chefe de Equipa.
UPDATE "users" SET "name" = 'Incognit Truth, Unipessoal Lda', "job_title" = NULL, "mobile" = NULL, "work_email" = NULL
WHERE "role" = 'admin' AND lower("name") LIKE 'leonardo%rocha%';
--> statement-breakpoint
UPDATE "users" SET "job_title" = 'Diretor Comercial', "mobile" = '931045401', "work_email" = 'leonardo@basecom.pt'
WHERE "role" <> 'admin' AND lower("name") LIKE 'leonardo%rocha%' AND "job_title" IS NULL AND "mobile" IS NULL;
