import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { AuthError } from "./auth/service.js";
import type { Db } from "./db/client.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { setupRoutes } from "./routes/setup.js";
import { importRoutes } from "./routes/imports.js";
import { companyRoutes } from "./routes/companies.js";
import { campaignRoutes } from "./routes/campaigns.js";
import { dialerRoutes } from "./routes/dialer.js";
import { timeRoutes } from "./routes/time.js";

export function buildApp(deps: { db: Db; encryptionKey: string; logger?: boolean }) {
  const app = Fastify({ logger: deps.logger ?? false });
  // Erros com mensagens em português; detalhes técnicos só no registo do servidor.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AuthError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "Dados em falta ou inválidos." });
    app.log.error(err);
    return reply.code(500).send({ error: "Ocorreu um erro. Tente novamente." });
  });
  // A aplicação usa token (não cookies); o servidor aceita pedidos da aplicação de computador.
  app.register(cors, { origin: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] });
  app.register(healthRoutes, { db: deps.db });
  app.register(authRoutes, { db: deps.db, encryptionKey: deps.encryptionKey });
  app.register(adminRoutes, { db: deps.db });
  app.register(setupRoutes, { db: deps.db, encryptionKey: deps.encryptionKey });
  app.register(importRoutes, { db: deps.db, encryptionKey: deps.encryptionKey });
  app.register(companyRoutes, { db: deps.db });
  app.register(campaignRoutes, { db: deps.db });
  app.register(dialerRoutes, { db: deps.db });
  app.register(timeRoutes, { db: deps.db });
  return app;
}
