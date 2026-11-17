import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { getSetting } from "../settings.js";
import { logMessage } from "../messages/service.js";

/** Mensagens rápidas: modelos (todos leem) e registo/envio (SMS pelo telemóvel). */
export async function messageRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const any = { preHandler: requireAuth(db) };
  app.get("/messages/templates", any, async () => ({ templates: (await getSetting(db, "messages")).templates.filter((t) => t.active) }));
  app.post("/companies/:id/messages", any, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ channel: z.enum(["whatsapp", "sms", "email"]), templateId: z.string().max(40).optional(), to: z.string().trim().min(3).max(200), text: z.string().max(2000) }).parse(req.body);
    return logMessage(db, req.user!, id, b);
  });
}
