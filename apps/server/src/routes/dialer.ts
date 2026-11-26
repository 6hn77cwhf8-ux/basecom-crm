import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { auditLog } from "../db/schema.js";
import { closeCallWithoutResult, followUpEntry, companyScriptView, discardCall, skipEntry, completeTask, dialerAssignments, myDialerCampaign, setDialerCampaign, endCall, entryView, myTasks, nextEntry, releaseEntry, saveResult, startCall } from "../dialer/service.js";

/** Power Dialer, chamadas e Agenda: todos os perfis (cada um sobre o seu trabalho). */
export async function dialerRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const any = { preHandler: requireAuth(db) };
  const id = z.object({ id: z.string().uuid() });
  const day = z.string().date();
  const instant = z.string().datetime({ offset: true });

  const admin = { preHandler: requireAuth(db, ["admin"]) };
  app.get("/dialer/my-campaign", any, async (req) => ({ campaignId: await myDialerCampaign(db, req.user!) }));
  app.get("/dialer/assignments", admin, async () => ({ users: await dialerAssignments(db) }));
  app.put("/users/:id/dialer-campaign", admin, async (req) => {
    await setDialerCampaign(db, req.user!, id.parse(req.params).id, z.object({ campaignId: z.string().uuid().nullable() }).parse(req.body).campaignId);
    return { ok: true };
  });
  app.post("/dialer/next", any, async (req) => ({ next: await nextEntry(db, req.user!, z.object({ campaignId: z.string().uuid() }).parse(req.body).campaignId) }));
  app.get("/dialer/entries/:id", any, async (req) => entryView(db, req.user!, id.parse(req.params).id));
  app.post("/dialer/entries/:id/skip", any, async (req) => { await skipEntry(db, req.user!, id.parse(req.params).id, z.object({ reason: z.string().max(500) }).parse(req.body).reason); return { ok: true }; });
  app.post("/dialer/entries/:id/followup", any, async (req) => followUpEntry(db, req.user!, id.parse(req.params).id, new Date(z.object({ at: z.string().datetime() }).parse(req.body).at)));
  app.post("/calls/:id/no-result", any, async (req) => { await closeCallWithoutResult(db, req.user!, id.parse(req.params).id, z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {}).note); return { ok: true }; });
  app.post("/dialer/entries/:id/release", any, async (req) => { await releaseEntry(db, req.user!, id.parse(req.params).id); return { ok: true }; });
  app.post("/calls", any, async (req) => {
    const b = z.object({ companyId: z.string().uuid(), contactId: z.string().uuid().nullable().optional(), entryId: z.string().uuid().nullable().optional(), source: z.enum(["new", "current", "wallet", "ficha", "agenda", "recebida", "retribuir", "cliente"]), consultedNos: z.boolean().optional(), phone: z.string().max(20).optional() }).parse(req.body);
    return startCall(db, req.user!, b);
  });
  app.post("/calls/:id/end", any, async (req) => endCall(db, req.user!, id.parse(req.params).id));
  // 20 nov: o Ligar ficou parado no 0 sem marcar — regista o estado do ecrã para se perceber a causa.
  app.get("/companies/:id/script-view", any, async (req) => companyScriptView(db, req.user!, id.parse(req.params).id));
  app.post("/dialer/stall", any, async (req) => {
    const b = z.object({ reason: z.string().max(80), state: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional() }).parse(req.body);
    await db.insert(auditLog).values({ userId: req.user!.id, action: "dialer_parado", entity: "user", entityId: req.user!.id, details: `${b.reason} · ${JSON.stringify(b.state ?? {})}`.slice(0, 1000) });
    return { ok: true };
  });
  app.post("/calls/:id/discard", any, async (req) => { await discardCall(db, req.user!, id.parse(req.params).id); return { ok: true }; });
  app.post("/calls/:id/result", any, async (req) => {
    const b = z.object({
      outcomeId: z.string().min(1), reasonId: z.string().optional(), comment: z.string().max(2000).optional(),
      date: z.union([day, z.literal("NS/NR")]).optional(), at: instant.optional(), forMe: z.boolean().optional(), nextAction: z.string().max(300).optional(),
      services: z.string().max(500).optional(), decisorName: z.string().max(120).optional(),
      competitor: z.object({ operator: z.string().max(40).optional(), renewalDate: day.optional(), text: z.string().max(1000).optional() }).optional(),
      walletKind: z.enum(["NC", "FC", "NN"]).optional(),
      newDecisor: z.object({ salutation: z.string().max(20).nullable().optional(), name: z.string().trim().min(2).max(120) }).optional(),
      opCode: z.string().trim().max(20).optional(),
      saleTypes: z.object({ NN: z.number().min(0).max(100000).optional(), FID: z.number().min(0).max(100000).optional(), XSell: z.number().min(0).max(100000).optional(), Upsell: z.number().min(0).max(100000).optional() }).optional(),
      followUp: z.enum(["call", "sms", "email", "whatsapp"]).optional(),
      l2b: z.object({ monthly: z.number().min(0).max(100000).optional(), contractMonths: z.number().int().min(1).max(60).optional(), monthsLeft: z.number().int().min(0).max(60).optional() }).optional(),
    }).parse(req.body);
    return saveResult(db, req.user!, id.parse(req.params).id, b);
  });
  app.get("/tasks", any, async (req) => ({ tasks: await myTasks(db, req.user!) }));
  app.post("/tasks/:id/done", any, async (req) => { await completeTask(db, req.user!, id.parse(req.params).id, "done"); return { ok: true }; });
}
