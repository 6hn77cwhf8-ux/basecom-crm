import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { callStatus, createPairingCode, deviceEvent, deviceFromToken, latestIncoming, myDevice, nextCommand, pairDevice, unpairDevice } from "../phone/service.js";

/** Telefonia: rotas do CRM (sessão do utilizador) e da app Android (token do telemóvel, cabeçalho «Authorization: Device …»). */
export async function phoneRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const any = { preHandler: requireAuth(db) };
  const deviceToken = (req: FastifyRequest) => String(req.headers.authorization ?? "").replace(/^Device\s+/i, "") || undefined;

  // CRM
  app.post("/devices/pair-code", any, async (req) => createPairingCode(db, req.user!));
  app.get("/devices/me", any, async (req) => ({ device: await myDevice(db, req.user!.id) }));
  app.delete("/devices/me", any, async (req) => { await unpairDevice(db, req.user!); return { ok: true }; });
  app.get("/calls/:id/status", any, async (req) => callStatus(db, req.user!, z.object({ id: z.string().uuid() }).parse(req.params).id));
  app.get("/phone/incoming", any, async (req) => ({ incoming: await latestIncoming(db, req.user!) }));

  // App Android
  app.post("/device/pair", async (req) => {
    const b = z.object({ code: z.string().regex(/^\d{6}$/), model: z.string().max(80).optional() }).parse(req.body);
    return pairDevice(db, b.code, b.model);
  });
  app.get("/device/next", async (req) => {
    const d = await deviceFromToken(db, deviceToken(req));
    return { command: await nextCommand(db, d.id) };
  });
  app.post("/device/events", async (req) => {
    const d = await deviceFromToken(db, deviceToken(req));
    const ev = z.discriminatedUnion("type", [
      z.object({ type: z.literal("outgoing_ended"), callId: z.string().uuid(), endedAt: z.string().datetime({ offset: true }), durationSeconds: z.number().int().min(0).max(86400) }),
      z.object({ type: z.literal("incoming_ringing"), number: z.string().max(40), at: z.string().datetime({ offset: true }) }),
      z.object({ type: z.literal("incoming_ended"), incomingId: z.string().uuid(), endedAt: z.string().datetime({ offset: true }), durationSeconds: z.number().int().min(0).max(86400) }),
    ]).parse(req.body);
    return deviceEvent(db, d, ev);
  });
  app.get("/device/me", async (req) => {
    const d = await deviceFromToken(db, deviceToken(req));
    return { ok: true, userId: d.userId };
  });
}
