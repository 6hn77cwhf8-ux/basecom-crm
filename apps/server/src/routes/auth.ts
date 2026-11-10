import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { AuthError, confirmTotp, login, logout, userForToken, type PublicUser } from "../auth/service.js";

declare module "fastify" {
  interface FastifyRequest { user?: PublicUser }
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

/** Usar em todas as rotas protegidas: responde 401 sem sessão válida. */
export function requireAuth(db: Db) {
  return async (req: FastifyRequest) => {
    const token = bearer(req);
    const user = token ? await userForToken(db, token) : null;
    if (!user) throw new AuthError(401, "Sessão terminada. Entre novamente.");
    req.user = user;
  };
}

export async function authRoutes(app: FastifyInstance, opts: { db: Db; encryptionKey: string }) {
  const { db, encryptionKey } = opts;

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AuthError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "Dados em falta ou inválidos." });
    app.log.error(err);
    return reply.code(500).send({ error: "Ocorreu um erro. Tente novamente." });
  });

  app.post("/auth/login", async (req) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    return login(db, encryptionKey, body.email, body.password);
  });

  app.post("/auth/totp", async (req) => {
    const body = z.object({ challengeToken: z.string().min(10), code: z.string().min(6), device: z.string().max(120).optional() }).parse(req.body);
    return confirmTotp(db, encryptionKey, body.challengeToken, body.code, body.device);
  });

  app.get("/auth/me", { preHandler: requireAuth(db) }, async (req) => ({ user: req.user }));

  app.post("/auth/logout", { preHandler: requireAuth(db) }, async (req) => {
    await logout(db, bearer(req)!);
    return { ok: true };
  });
}
