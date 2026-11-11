import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { companyKpis, filterOptions, getCompany, listCompanies, quickSearch } from "../companies/service.js";
import { auditForeignView, cancelScheduled, listScheduled, scheduleTransfer, setContactStatus, setDoNotContact, setWalletKind, walletHistory } from "../companies/wallet.js";

/** Empresas: todos os perfis consultam (a carteira só limita tarefas e campanhas). */
export async function companyRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const any = { preHandler: requireAuth(db) };

  app.get("/companies", any, async (req) => {
    const f = z.object({
      q: z.string().max(100).optional(), accountType: z.enum(["client", "prospect"]).optional(),
      owner: z.union([z.literal("none"), z.literal("any"), z.string().uuid()]).optional(), wallet: z.enum(["NC", "FC"]).optional(),
      status: z.enum(["dnc", "review", "nif"]).optional(), municipality: z.string().max(100).optional(),
      district: z.string().max(100).optional(), sector: z.string().max(100).optional(),
      offset: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(200).optional(),
    }).parse(req.query);
    return listCompanies(db, f);
  });
  app.get("/companies/kpis", any, async () => companyKpis(db));
  app.get("/companies/options", any, async () => filterOptions(db));
  app.get("/search", any, async (req) => ({ results: await quickSearch(db, z.object({ q: z.string().max(100) }).parse(req.query).q) }));
  app.get("/companies/:id", any, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const r = await getCompany(db, id);
    await auditForeignView(db, req.user!, id, r.company.ownerId);
    return { ...r, wallet: await walletHistory(db, id) };
  });

  const admin = { preHandler: requireAuth(db, ["admin"]) };
  const reason = z.string().trim().min(3).max(500);
  app.post("/companies/transfer", admin, async (req) => {
    const b = z.object({ companyIds: z.array(z.string().uuid()).min(1).max(5000), toOwnerId: z.string().uuid().nullable(), when: z.enum(["current", "next"]), reason }).parse(req.body);
    return scheduleTransfer(db, req.user!, b);
  });
  app.get("/wallet/scheduled", admin, async () => ({ changes: await listScheduled(db) }));
  app.post("/wallet/scheduled/:id/cancel", admin, async (req) => { await cancelScheduled(db, req.user!, z.object({ id: z.string().uuid() }).parse(req.params).id); return { ok: true }; });
  app.post("/companies/:id/wallet-kind", any, async (req) => {
    const b = z.object({ kind: z.enum(["NC", "FC"]), reason }).parse(req.body);
    await setWalletKind(db, req.user!, z.object({ id: z.string().uuid() }).parse(req.params).id, b.kind, b.reason);
    return { ok: true };
  });
  app.post("/companies/:id/do-not-contact", any, async (req) => {
    const b = z.object({ value: z.boolean(), reason }).parse(req.body);
    await setDoNotContact(db, req.user!, z.object({ id: z.string().uuid() }).parse(req.params).id, b.value, b.reason);
    return { ok: true };
  });
  app.patch("/contacts/:id", any, async (req) => {
    const b = z.object({ status: z.enum(["valid", "incorrect"]) }).parse(req.body);
    await setContactStatus(db, req.user!, z.object({ id: z.string().uuid() }).parse(req.params).id, b.status);
    return { ok: true };
  });
}
