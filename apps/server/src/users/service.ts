import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { auditLog, sessions, users } from "../db/schema.js";
import { AuthError, hashPassword } from "../auth/service.js";

export type Role = "admin" | "team_lead" | "sales";
const tempPassword = () => randomBytes(9).toString("base64url");
const ROLE_PT: Record<Role, string> = { admin: "Administrador", team_lead: "Chefe de Equipa", sales: "Comercial" };

async function audit(db: Db, by: string, action: string, targetId: string, details?: string) {
  await db.insert(auditLog).values({ userId: by, action, entity: "user", entityId: targetId, details });
}

export async function listUsers(db: Db) {
  const rows = await db.query.users.findMany({ orderBy: [desc(users.active), users.name] });
  return rows.map((u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, hiredAt: u.hiredAt,
    totpEnabled: u.totpEnabled, mustChangePassword: u.mustChangePassword,
    locked: !!u.lockedUntil && u.lockedUntil > new Date(), createdAt: u.createdAt,
  }));
}

/** Cria um utilizador com palavra-passe provisória (mostrada uma única vez). */
export async function createUser(db: Db, by: string, input: { name: string; email: string; role: Role; hiredAt?: Date | null }) {
  const email = input.email.trim().toLowerCase();
  if (await db.query.users.findFirst({ where: eq(users.email, email) })) throw new AuthError(409, "Já existe um utilizador com este email.");
  const password = tempPassword();
  const [u] = await db.insert(users).values({ name: input.name.trim(), email, role: input.role, hiredAt: input.hiredAt ?? null, passwordHash: await hashPassword(password) }).returning();
  await audit(db, by, "utilizador_criado", u!.id, `${input.name} · ${ROLE_PT[input.role]}`);
  return { id: u!.id, tempPassword: password };
}

export async function updateUser(db: Db, by: string, id: string, patch: { name?: string; role?: Role; active?: boolean; hiredAt?: Date | null }) {
  if (id === by && (patch.active === false || (patch.role && patch.role !== "admin"))) {
    throw new AuthError(400, "Não pode desativar nem retirar o perfil de Administrador à sua própria conta.");
  }
  await db.update(users).set(patch).where(eq(users.id, id));
  if (patch.active === false) await revokeAllSessions(db, id);
  await audit(db, by, "utilizador_alterado", id, JSON.stringify(patch));
}

export async function resetPassword(db: Db, by: string, id: string) {
  const password = tempPassword();
  await db.update(users).set({ passwordHash: await hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null }).where(eq(users.id, id));
  await revokeAllSessions(db, id);
  await audit(db, by, "palavra_passe_reposta", id);
  return { tempPassword: password };
}

/** Telemóvel perdido ou trocado: a 2FA volta a ser ativada na próxima entrada. */
export async function resetTotp(db: Db, by: string, id: string) {
  await db.update(users).set({ totpEnabled: false, totpSecretEnc: null }).where(eq(users.id, id));
  await revokeAllSessions(db, id);
  await audit(db, by, "2fa_reposta", id);
}

export async function listSessions(db: Db, userId: string) {
  return db.query.sessions.findMany({
    where: and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())),
    columns: { id: true, device: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    orderBy: [desc(sessions.lastSeenAt)],
  });
}

export async function revokeSession(db: Db, by: string, sessionId: string) {
  const [s] = await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId)).returning();
  if (s) await audit(db, by, "sessao_terminada", s.userId, s.device ?? undefined);
}

async function revokeAllSessions(db: Db, userId: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function listAudit(db: Db, limit = 200) {
  const rows = await db.query.auditLog.findMany({ orderBy: [desc(auditLog.at)], limit });
  const names = new Map((await db.query.users.findMany({ columns: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, userName: r.userId ? names.get(r.userId) ?? "—" : "—", targetName: r.entity === "user" && r.entityId ? names.get(r.entityId) ?? null : null }));
}
