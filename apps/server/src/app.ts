import Fastify from "fastify";
import type { Db } from "./db/client.js";
import { healthRoutes } from "./routes/health.js";

export function buildApp(deps: { db: Db; logger?: boolean }) {
  const app = Fastify({ logger: deps.logger ?? false });
  app.register(healthRoutes, { db: deps.db });
  return app;
}
