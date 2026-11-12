import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { AUDIT_GROUPS, type AuditGroup, createUser, listAudit, listSessions, listUsers, resetPassword, resetTotp, revokeSession, updateUser } from "../users/service.js";
import { getAllSettings, getSetting, setSetting, SETTINGS, type SettingKey } from "../settings.js";

const role = z.enum(["admin", "team_lead", "sales"]);
const date = z.string().date().nullable().optional().transform((v) => (v ? new Date(`${v}T00:00:00Z`) : v === null ? null : undefined));

/** Gestão de utilizadores, configurações e auditoria: só o Administrador. */
export async function adminRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const admin = { preHandler: requireAuth(db, ["admin"]) };
  const id = z.object({ id: z.string().uuid() });

  app.get("/users", { preHandler: requireAuth(db, ["admin", "team_lead"]) }, async () => ({ users: await listUsers(db) }));

  app.post("/users", admin, async (req) => {
    const b = z.object({ name: z.string().min(2).max(120), email: z.string().email(), role, hiredAt: date }).parse(req.body);
    return createUser(db, req.user!.id, { ...b, hiredAt: b.hiredAt ?? null });
  });

  app.patch("/users/:id", admin, async (req) => {
    const b = z.object({ name: z.string().min(2).max(120).optional(), role: role.optional(), active: z.boolean().optional(), hiredAt: date }).parse(req.body);
    await updateUser(db, req.user!.id, id.parse(req.params).id, b);
    return { ok: true };
  });

  app.post("/users/:id/reset-password", admin, async (req) => resetPassword(db, req.user!.id, id.parse(req.params).id));
  app.post("/users/:id/reset-2fa", admin, async (req) => { await resetTotp(db, req.user!.id, id.parse(req.params).id); return { ok: true }; });
  app.get("/users/:id/sessions", admin, async (req) => ({ sessions: await listSessions(db, id.parse(req.params).id) }));
  app.delete("/sessions/:id", admin, async (req) => { await revokeSession(db, req.user!.id, id.parse(req.params).id); return { ok: true }; });

  app.get("/settings", admin, async () => ({ settings: await getAllSettings(db) }));
  // Catálogos e limites de tempo: todos os perfis precisam deles para trabalhar (Power Dialer, resultados).
  app.get("/catalogs", { preHandler: requireAuth(db) }, async () => ({ catalogs: await getSetting(db, "catalogs"), timeLimits: await getSetting(db, "timeLimits") }));
  app.put("/settings/:key", admin, async (req) => {
    const { key } = z.object({ key: z.enum(Object.keys(SETTINGS) as [SettingKey, ...SettingKey[]]) }).parse(req.params);
    return { value: await setSetting(db, key, req.body, req.user!.id) };
  });

  app.get("/audit", admin, async (req) => {
    const q = z.object({ group: z.enum(Object.keys(AUDIT_GROUPS) as [AuditGroup, ...AuditGroup[]]).optional(), limit: z.coerce.number().int().min(1).max(1000).optional() }).parse(req.query);
    return { entries: await listAudit(db, q.limit ?? 200, q.group) };
  });
}
