import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { callFromWallet, walletList } from "../wallet/service.js";

export async function walletRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const any = { preHandler: requireAuth(db) };
  app.get("/wallet", any, async (req) => {
    const q = z.object({ ownerId: z.string().uuid().optional(), tasks: z.enum(["with", "without", "late"]).optional(), q: z.string().max(100).optional() }).parse(req.query);
    return { companies: await walletList(db, req.user!, q) };
  });
  app.post("/wallet/:id/call", any, async (req) => callFromWallet(db, req.user!, z.object({ id: z.string().uuid() }).parse(req.params).id));
}
