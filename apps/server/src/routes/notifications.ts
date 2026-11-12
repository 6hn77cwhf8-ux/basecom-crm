import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { markRead, myNotifications } from "../notifications/service.js";

export async function notificationRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const any = { preHandler: requireAuth(db) };
  app.get("/notifications", any, async (req) => myNotifications(db, req.user!));
  app.post("/notifications/read", any, async (req) => { await markRead(db, req.user!); return { ok: true }; });
}
