import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { AuthError } from "../auth/service.js";
import { daySummary, heartbeat, setState, teamToday } from "../time/service.js";
import { canSee } from "../teams/service.js";

/** Estados (A trabalhar, Formação, Intervalo, Mudança de campanha) e ponto. */
export async function timeRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const any = { preHandler: requireAuth(db) };
  app.post("/time/heartbeat", any, async (req) => ({ state: await heartbeat(db, req.user!) }));
  app.post("/time/state", any, async (req) => {
    const b = z.object({ state: z.enum(["working", "training", "break", "switch"]), userId: z.string().uuid().optional() }).parse(req.body);
    await setState(db, req.user!, b.userId ?? req.user!.id, b.state);
    return daySummary(db, b.userId ?? req.user!.id);
  });
  app.get("/time/today", any, async (req) => {
    const { userId } = z.object({ userId: z.string().uuid().optional() }).parse(req.query);
    if (userId && !(await canSee(db, req.user!, userId))) throw new AuthError(403, "Só vê os tempos da sua equipa.");
    return daySummary(db, userId ?? req.user!.id);
  });
  app.get("/time/team", any, async (req) => ({ people: await teamToday(db, req.user!) }));
}
