import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { hash, verify } from "@node-rs/argon2";
import type { Db } from "../db/client.js";
import { auditLog, authChallenges, sessions, users } from "../db/schema.js";
import { decrypt, encrypt, hashToken, newToken } from "./crypto.js";
import { newTotpSecret, totpEnrollment, verifyTotp } from "./totp.js";

/** Valores iniciais propostos; passam para as Configurações do Administrador. */
export const AUTH_RULES = {
  maxFailedLogins: 5,
  lockMinutes: 15,
  challengeMinutes: 5,
  maxCodeAttempts: 5,
  sessionHours: 12,
};

export type PublicUser = { id: string; name: string; email: string; role: "admin" | "team_lead" | "sales" };
export class AuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const WRONG = "Email ou palavra-passe incorretos.";
const minutes = (m: number) => new Date(Date.now() + m * 60_000);

export async function hashPassword(password: string) {
  return hash(password);
}

async function audit(db: Db, userId: string | null, action: string, details?: string) {
  await db.insert(auditLog).values({ userId, action, entity: "user", entityId: userId, details });
}

export async function login(db: Db, key: string, email: string, password: string) {
  const user = await db.query.users.findFirst({ where: eq(users.email, email.trim().toLowerCase()) });
  if (!user || !user.active || !user.passwordHash) {
    await audit(db, null, "login_falhado", `email: ${email}`);
    throw new AuthError(401, WRONG);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AuthError(423, "Conta bloqueada temporariamente por várias tentativas falhadas. Tente mais tarde ou fale com o Administrador.");
  }
  if (!(await verify(user.passwordHash, password))) {
    const failed = user.failedLogins + 1;
    const lock = failed >= AUTH_RULES.maxFailedLogins ? minutes(AUTH_RULES.lockMinutes) : null;
    await db.update(users).set({ failedLogins: lock ? 0 : failed, lockedUntil: lock }).where(eq(users.id, user.id));
    await audit(db, user.id, lock ? "conta_bloqueada" : "login_falhado");
    throw new AuthError(401, WRONG);
  }
  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
  const { token, hash: tokenHash } = newToken();
  if (user.totpEnabled) {
    await db.insert(authChallenges).values({ tokenHash, userId: user.id, expiresAt: minutes(AUTH_RULES.challengeMinutes) });
    return { step: "totp" as const, challengeToken: token };
  }
  // Primeira entrada: ativar a 2FA no Microsoft Authenticator.
  const secret = newTotpSecret();
  await db.insert(authChallenges).values({ tokenHash, userId: user.id, pendingTotpSecretEnc: encrypt(secret, key), expiresAt: minutes(AUTH_RULES.challengeMinutes) });
  const enrol = await totpEnrollment(secret, user.email);
  return { step: "enroll" as const, challengeToken: token, qrDataUrl: enrol.qrDataUrl, secret: enrol.secret };
}

export async function confirmTotp(db: Db, key: string, challengeToken: string, code: string, device?: string) {
  const ch = await db.query.authChallenges.findFirst({
    where: and(eq(authChallenges.tokenHash, hashToken(challengeToken)), isNull(authChallenges.usedAt), gt(authChallenges.expiresAt, new Date())),
  });
  if (!ch) throw new AuthError(401, "O pedido expirou. Volte a introduzir o email e a palavra-passe.");
  if (ch.attempts >= AUTH_RULES.maxCodeAttempts) throw new AuthError(401, "Demasiados códigos errados. Volte a introduzir o email e a palavra-passe.");
  const user = await db.query.users.findFirst({ where: eq(users.id, ch.userId) });
  if (!user || !user.active) throw new AuthError(401, WRONG);

  const secretEnc = ch.pendingTotpSecretEnc ?? user.totpSecretEnc;
  if (!secretEnc || !verifyTotp(decrypt(secretEnc, key), user.email, code)) {
    await db.update(authChallenges).set({ attempts: sql`${authChallenges.attempts} + 1` }).where(eq(authChallenges.id, ch.id));
    await audit(db, user.id, "codigo_2fa_errado");
    throw new AuthError(401, "Código incorreto. Confirme o código no Microsoft Authenticator.");
  }
  await db.update(authChallenges).set({ usedAt: new Date() }).where(eq(authChallenges.id, ch.id));
  if (ch.pendingTotpSecretEnc) {
    await db.update(users).set({ totpSecretEnc: ch.pendingTotpSecretEnc, totpEnabled: true }).where(eq(users.id, user.id));
    await audit(db, user.id, "2fa_ativada");
  }
  const { token, hash: tokenHash } = newToken();
  const expiresAt = new Date(Date.now() + AUTH_RULES.sessionHours * 3_600_000);
  await db.insert(sessions).values({ tokenHash, userId: user.id, device: device ?? null, expiresAt });
  await audit(db, user.id, "login", device);
  return { token, expiresAt, user: toPublic(user) };
}

export async function userForToken(db: Db, token: string): Promise<PublicUser | null> {
  const s = await db.query.sessions.findFirst({
    where: and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())),
  });
  if (!s) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, s.userId) });
  if (!user || !user.active) return null;
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, s.id));
  return toPublic(user);
}

export async function logout(db: Db, token: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)));
}

function toPublic(u: typeof users.$inferSelect): PublicUser {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}
