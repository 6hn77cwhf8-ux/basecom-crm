import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { markRead, myNotifications } from "../notifications/service.js";
import { ackHelp, helpStatus, pendingHelp, requestHelp } from "../help/service.js";
import { z } from "zod";

export async function notificationRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const any = { preHandler: requireAuth(db) };
  app.get("/notifications", any, async (req) => myNotifications(db, req.user!));
  // Pedir ajuda (26 nov).
  app.post("/help", any, async (req) => requestHelp(db, req.user!, z.object({ companyId: z.string().uuid().nullable().optional(), reason: z.string().max(200).nullable().optional() }).parse(req.body ?? {})));
  app.get("/help/pending", any, async (req) => ({ items: await pendingHelp(db, req.user!) }));
  app.post("/help/:id/ack", any, async (req) => ackHelp(db, req.user!, z.object({ id: z.string().uuid() }).parse(req.params).id));
  app.get("/help/:id", any, async (req) => helpStatus(db, req.user!, z.object({ id: z.string().uuid() }).parse(req.params).id));
  app.post("/notifications/read", any, async (req) => { await markRead(db, req.user!); return { ok: true }; });
}
