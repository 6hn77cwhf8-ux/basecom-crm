ALTER TABLE "campaigns" ADD COLUMN "script_pitch_new" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "script_pitch_current" text;--> statement-breakpoint
UPDATE "campaigns" SET "script" = 'Olá, o meu nome é {comercial} e estava a entrar em contacto porque gostaria de falar com a pessoa responsável da empresa {empresa}. Seria possível? Falo com {decisor}?' WHERE "script" = 'Olá, o meu nome é {comercial}. Eu gostaria de falar com a pessoa responsável da empresa {empresa}, seria possível?';
