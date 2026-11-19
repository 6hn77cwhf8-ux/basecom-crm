import { DEFAULT_SIGNATURE, renderSignature } from "@basecom/shared";
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
  // Modelos e a assinatura de quem envia (WhatsApp e email); sem cargo nem telemóvel, sem assinatura.
  app.get("/messages/templates", any, async (req) => {
    const m = await getSetting(db, "messages");
    const u = req.user!;
    const signature = renderSignature(m.signature ?? DEFAULT_SIGNATURE, { comercial: u.name, cargo: u.jobTitle, telemovel: u.mobile, email: u.workEmail ?? u.email });
    return { templates: m.templates.filter((t) => t.active), signature };
  });
  app.post("/companies/:id/messages", any, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ channel: z.enum(["whatsapp", "sms", "email"]), templateId: z.string().max(40).optional(), to: z.string().trim().min(3).max(200), text: z.string().max(2000) }).parse(req.body);
    return logMessage(db, req.user!, id, b);
  });
}
