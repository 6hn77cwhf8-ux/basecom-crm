import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { completeTask, dialerAssignments, myDialerCampaign, setDialerCampaign, endCall, entryView, myTasks, nextEntry, releaseEntry, saveResult, startCall } from "../dialer/service.js";

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
  app.post("/dialer/entries/:id/release", any, async (req) => { await releaseEntry(db, req.user!, id.parse(req.params).id); return { ok: true }; });
  app.post("/calls", any, async (req) => {
    const b = z.object({ companyId: z.string().uuid(), contactId: z.string().uuid().nullable().optional(), entryId: z.string().uuid().nullable().optional(), source: z.enum(["new", "current", "wallet", "ficha", "agenda"]) }).parse(req.body);
    return startCall(db, req.user!, b);
  });
  app.post("/calls/:id/end", any, async (req) => endCall(db, req.user!, id.parse(req.params).id));
  app.post("/calls/:id/result", any, async (req) => {
    const b = z.object({
      outcomeId: z.string().min(1), reasonId: z.string().optional(), comment: z.string().max(2000).optional(),
      date: day.optional(), at: instant.optional(), forMe: z.boolean().optional(), nextAction: z.string().max(300).optional(),
      services: z.string().max(500).optional(), decisorName: z.string().max(120).optional(),
      competitor: z.object({ operator: z.string().max(40).optional(), renewalDate: day.optional(), text: z.string().max(1000).optional() }).optional(),
      walletKind: z.enum(["NC", "FC"]).optional(),
    }).parse(req.body);
    return saveResult(db, req.user!, id.parse(req.params).id, b);
  });
  app.get("/tasks", any, async (req) => ({ tasks: await myTasks(db, req.user!) }));
  app.post("/tasks/:id/done", any, async (req) => { await completeTask(db, req.user!, id.parse(req.params).id, "done"); return { ok: true }; });
}
