import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { companyOpportunities, createOpportunity, listOpportunities, logOpportunityActivity, loseOpportunity, moveOpportunity, winOpportunity } from "../opportunities/service.js";

export async function opportunityRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const any = { preHandler: requireAuth(db) };
  const id = z.object({ id: z.string().uuid() });
  app.get("/opportunities", any, async (req) => {
    const q = z.object({ ownerId: z.string().uuid().optional(), closed: z.enum(["1"]).optional() }).parse(req.query);
    return { opportunities: await listOpportunities(db, req.user!, { ownerId: q.ownerId, closed: !!q.closed }) };
  });
  app.get("/companies/:id/opportunities", any, async (req) => ({ opportunities: await companyOpportunities(db, id.parse(req.params).id) }));
  app.post("/opportunities", any, async (req) => createOpportunity(db, req.user!, z.object({ companyId: z.string().uuid(), stage: z.string().optional(), services: z.string().max(500).optional() }).parse(req.body)));
  app.post("/opportunities/:id/stage", any, async (req) => {
    const b = z.object({ stage: z.string(), comment: z.string().max(500).optional() }).parse(req.body);
    await moveOpportunity(db, req.user!, id.parse(req.params).id, b.stage, b.comment); return { ok: true };
  });
  app.post("/opportunities/:id/activity", any, async (req) => {
    const b = z.object({ text: z.string().max(1000), services: z.string().max(500).optional() }).parse(req.body);
    await logOpportunityActivity(db, req.user!, id.parse(req.params).id, b.text, b.services); return { ok: true };
  });
  app.post("/opportunities/:id/win", any, async (req) => { await winOpportunity(db, req.user!, id.parse(req.params).id); return { ok: true }; });
  app.post("/opportunities/:id/lose", any, async (req) => {
    const b = z.object({ reasonId: z.string().min(1), comment: z.string().max(1000).optional(), operator: z.string().max(40).optional(), date: z.string().date().optional() }).parse(req.body);
    await loseOpportunity(db, req.user!, id.parse(req.params).id, b.reasonId, b.comment, { operator: b.operator, date: b.date }); return { ok: true };
  });
}
