import { setState } from "../time/service.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { AuthError, changePassword, confirmTotp, login, logout, userForToken, type PublicUser } from "../auth/service.js";

declare module "fastify" {
  interface FastifyRequest { user?: PublicUser }
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

/**
 * Usar em todas as rotas protegidas: responde 401 sem sessão válida.
 * Com `roles`, responde 403 a quem não tem um desses perfis.
 * Enquanto a palavra-passe provisória não for trocada, só deixa trocar a palavra-passe.
 */
export function requireAuth(db: Db, roles?: PublicUser["role"][], opts: { allowPendingPassword?: boolean } = {}) {
  return async (req: FastifyRequest) => {
    const token = bearer(req);
    const user = token ? await userForToken(db, token) : null;
    if (!user) throw new AuthError(401, "Sessão terminada. Entre novamente.");
    if (user.mustChangePassword && !opts.allowPendingPassword) throw new AuthError(403, "Tem de alterar a palavra-passe provisória.");
    if (roles && !roles.includes(user.role)) throw new AuthError(403, "Não tem permissão para esta ação.");
    req.user = user;
  };
}

export async function authRoutes(app: FastifyInstance, opts: { db: Db; encryptionKey: string }) {
  const { db, encryptionKey } = opts;



  app.post("/auth/login", async (req) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    return login(db, encryptionKey, body.email, body.password);
  });

  app.post("/auth/totp", async (req) => {
    const body = z.object({ challengeToken: z.string().min(10), code: z.string().min(6), device: z.string().max(120).optional() }).parse(req.body);
    return confirmTotp(db, encryptionKey, body.challengeToken, body.code, body.device);
  });

  app.get("/auth/me", { preHandler: requireAuth(db, undefined, { allowPendingPassword: true }) }, async (req) => ({ user: req.user }));

  app.post("/auth/password", { preHandler: requireAuth(db, undefined, { allowPendingPassword: true }) }, async (req) => {
    const body = z.object({ current: z.string().min(1), next: z.string().min(1) }).parse(req.body);
    await changePassword(db, req.user!.id, body.current, body.next);
    return { ok: true };
  });

  app.post("/auth/logout", { preHandler: requireAuth(db, undefined, { allowPendingPassword: true }) }, async (req) => {
    await setState(db, req.user!, req.user!.id, "off"); // saída no registo de ponto
    await logout(db, bearer(req)!);
    return { ok: true };
  });
}
