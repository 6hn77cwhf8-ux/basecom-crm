import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { cycleForDate } from "@basecom/shared";
import type { Db } from "../db/client.js";

/** Estado do servidor: usado pela vigilância automática (de minuto a minuto). */
export async function healthRoutes(app: FastifyInstance, opts: { db: Db }) {
  app.get("/health", async (_req, reply) => {
    let database: "ok" | "erro" = "ok";
    try {
      await opts.db.execute(sql`select 1`);
    } catch {
      database = "erro";
    }
    const cycle = cycleForDate(new Date());
    const body = { status: database === "ok" ? "ok" : "degradado", database, cycle: cycle.label };
    return reply.code(database === "ok" ? 200 : 503).send(body);
  });
}
