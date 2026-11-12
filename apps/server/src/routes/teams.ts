import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { deleteTeam, listTeams, saveTeam } from "../teams/service.js";

export async function teamRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const admin = { preHandler: requireAuth(db, ["admin"]) };
  const body = z.object({ name: z.string().max(80), leadId: z.string().uuid().nullable(), memberIds: z.array(z.string().uuid()).max(200) });
  const id = z.object({ id: z.string().uuid() });
  app.get("/teams", admin, async () => ({ teams: await listTeams(db) }));
  app.post("/teams", admin, async (req) => saveTeam(db, req.user!, body.parse(req.body)));
  app.put("/teams/:id", admin, async (req) => saveTeam(db, req.user!, { ...body.parse(req.body), id: id.parse(req.params).id }));
  app.delete("/teams/:id", admin, async (req) => { await deleteTeam(db, req.user!, id.parse(req.params).id); return { ok: true }; });
}
