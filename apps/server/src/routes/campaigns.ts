import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { createCampaign, filtersSchema, listCampaigns, previewCampaign, refreshCampaign, updateCampaign } from "../campaigns/service.js";

/**
 * Campanhas: trabalhar = as atribuídas; criar, editar, pausar e terminar = Administrador
 * (o Chefe de Equipa junta-se quando existirem equipas, conforme a matriz de permissões).
 */
export async function campaignRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const any = { preHandler: requireAuth(db) };
  const admin = { preHandler: requireAuth(db, ["admin"]) };
  const id = z.object({ id: z.string().uuid() });
  const members = z.array(z.string().uuid()).max(50);

  app.get("/campaigns", any, async (req) => ({ campaigns: await listCampaigns(db, req.user!) }));
  app.post("/campaigns/preview", admin, async (req) => {
    const b = z.object({ filters: filtersSchema, memberIds: members }).parse(req.body);
    return previewCampaign(db, b.filters, b.memberIds);
  });
  app.post("/campaigns", admin, async (req) => {
    const b = z.object({ name: z.string().trim().min(3).max(120), mode: z.enum(["new", "current"]), script: z.string().max(10000), scriptPitchNew: z.string().max(10000).nullable().optional(), scriptPitchCurrent: z.string().max(10000).nullable().optional(), dialMode: z.enum(["power", "preview"]).optional(), filters: filtersSchema, memberIds: members }).parse(req.body);
    return createCampaign(db, req.user!, b);
  });
  app.patch("/campaigns/:id", admin, async (req) => {
    const b = z.object({ name: z.string().trim().min(3).max(120).optional(), script: z.string().max(10000).optional(), scriptPitchNew: z.string().max(10000).nullable().optional(), scriptPitchCurrent: z.string().max(10000).nullable().optional(), dialMode: z.enum(["power", "preview"]).optional(), status: z.enum(["active", "paused", "ended"]).optional(), memberIds: members.optional() }).parse(req.body);
    await updateCampaign(db, req.user!, id.parse(req.params).id, b);
    return { ok: true };
  });
  app.post("/campaigns/:id/refresh", admin, async (req) => refreshCampaign(db, req.user!, id.parse(req.params).id));
}
