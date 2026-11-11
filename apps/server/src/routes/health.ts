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

  // Quem abrir crm.basecom.pt no navegador vê uma página simples (o CRM usa-se na aplicação).
  app.get("/", async (_req, reply) =>
    reply.type("text/html; charset=utf-8").send(
      `<!doctype html><html lang="pt-PT"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BASECOM CRM</title>` +
        `<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#1f2937">` +
        `<div style="text-align:center"><h1 style="margin:0 0 8px">BASECOM CRM</h1><p>Servidor ativo. Utilize a aplicação BASECOM CRM no computador.</p></div>`,
    ),
  );
}
