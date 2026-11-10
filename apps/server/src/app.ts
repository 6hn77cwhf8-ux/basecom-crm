import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Db } from "./db/client.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";

export function buildApp(deps: { db: Db; encryptionKey: string; logger?: boolean }) {
  const app = Fastify({ logger: deps.logger ?? false });
  // A aplicação usa token (não cookies); o servidor aceita pedidos da aplicação de computador.
  app.register(cors, { origin: true });
  app.register(healthRoutes, { db: deps.db });
  app.register(authRoutes, { db: deps.db, encryptionKey: deps.encryptionKey });
  return app;
}
