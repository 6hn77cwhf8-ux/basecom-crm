import type { FastifyInstance } from "fastify";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { auditLog, users } from "../db/schema.js";
import { AuthError, hashPassword } from "../auth/service.js";

/**
 * Primeiro arranque em produção: cria o primeiro Administrador sem acesso ao servidor.
 * Só funciona enquanto não existir nenhum utilizador. O código de arranque é derivado da
 * ENCRYPTION_KEY (só quem a conhece o consegue calcular).
 */
export function setupToken(encryptionKey: string) {
  return createHmac("sha256", Buffer.from(encryptionKey, "base64")).update("basecom-primeiro-administrador").digest("hex");
}

const body = z.object({ token: z.string(), name: z.string().min(2), email: z.string().email() });

export async function setupRoutes(app: FastifyInstance, opts: { db: Db; encryptionKey: string }) {
  const { db } = opts;
  const expected = Buffer.from(setupToken(opts.encryptionKey));

  app.post("/setup/first-admin", async (req, reply) => {
    const input = body.parse(req.body);
    const given = Buffer.from(input.token);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new AuthError(403, "Código de arranque inválido.");
    const password = randomBytes(9).toString("base64url");
    const passwordHash = await hashPassword(password);
    // Bloqueio dentro da transação: dois pedidos em simultâneo não criam dois administradores.
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`lock table ${users} in exclusive mode`);
      const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from ${users}`)).rows as [{ n: number }];
      if (n > 0) return null;
      const [u] = await tx.insert(users).values({ name: input.name.trim(), email: input.email.trim().toLowerCase(), role: "admin", passwordHash }).returning();
      await tx.insert(auditLog).values({ userId: u!.id, action: "primeiro_administrador_criado", entity: "user", entityId: u!.id, details: input.name.trim() });
      return u!;
    });
    if (!created) throw new AuthError(409, "O sistema já tem utilizadores. Use o ecrã Equipa.");
    return reply.code(201).send({ email: created.email, tempPassword: password });
  });
}
