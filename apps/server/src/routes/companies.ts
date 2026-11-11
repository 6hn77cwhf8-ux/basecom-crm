import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { companyKpis, filterOptions, getCompany, listCompanies, quickSearch } from "../companies/service.js";

/** Empresas: todos os perfis consultam (a carteira só limita tarefas e campanhas). */
export async function companyRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const any = { preHandler: requireAuth(db) };

  app.get("/companies", any, async (req) => {
    const f = z.object({
      q: z.string().max(100).optional(), accountType: z.enum(["client", "prospect"]).optional(),
      owner: z.union([z.literal("none"), z.literal("any"), z.string().uuid()]).optional(), wallet: z.enum(["NC", "FC"]).optional(),
      status: z.enum(["dnc", "review", "nif"]).optional(), municipality: z.string().max(100).optional(),
      district: z.string().max(100).optional(), sector: z.string().max(100).optional(),
      offset: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(200).optional(),
    }).parse(req.query);
    return listCompanies(db, f);
  });
  app.get("/companies/kpis", any, async () => companyKpis(db));
  app.get("/companies/options", any, async () => filterOptions(db));
  app.get("/search", any, async (req) => ({ results: await quickSearch(db, z.object({ q: z.string().max(100) }).parse(req.query).q) }));
  app.get("/companies/:id", any, async (req) => getCompany(db, z.object({ id: z.string().uuid() }).parse(req.params).id));
}
