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

const person = z.object({ name: z.string().min(2), email: z.string().email() });
const body = person.extend({
  token: z.string(),
  /** Restante equipa inicial (Comerciais), criada na mesma operação. */
  sales: z.array(person).max(20).default([]),
});

export async function setupRoutes(app: FastifyInstance, opts: { db: Db; encryptionKey: string }) {
  const { db } = opts;
  const expected = Buffer.from(setupToken(opts.encryptionKey));

  app.post("/setup/first-admin", async (req, reply) => {
    const input = body.parse(req.body);
    const given = Buffer.from(input.token);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new AuthError(403, "Código de arranque inválido.");
    const people = [{ ...input, role: "admin" as const }, ...input.sales.map((p) => ({ ...p, role: "sales" as const }))];
    const emails = people.map((p) => p.email.trim().toLowerCase());
    if (new Set(emails).size !== emails.length) throw new AuthError(400, "Há emails repetidos.");
    const prepared = await Promise.all(people.map(async (p, i) => {
      const password = randomBytes(9).toString("base64url");
      return { name: p.name.trim(), email: emails[i]!, role: p.role, password, passwordHash: await hashPassword(password) };
    }));
    // Bloqueio dentro da transação: dois pedidos em simultâneo não criam dois administradores.
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`lock table ${users} in exclusive mode`);
      const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from ${users}`)).rows as [{ n: number }];
      if (n > 0) return null;
      const rows = await tx.insert(users).values(prepared.map(({ password: _p, ...u }) => u)).returning();
      const admin = rows.find((u) => u.role === "admin")!;
      await tx.insert(auditLog).values(rows.map((u) => ({
        userId: admin.id, action: u.id === admin.id ? "primeiro_administrador_criado" : "utilizador_criado",
        entity: "user", entityId: u.id, details: `${u.name} · ${u.role === "admin" ? "Administrador" : "Comercial"}`,
      })));
      return rows;
    });
    if (!created) throw new AuthError(409, "O sistema já tem utilizadores. Use o ecrã Equipa.");
    const accounts = prepared.map((p) => ({ name: p.name, email: p.email, role: p.role, tempPassword: p.password }));
    return reply.code(201).send({ accounts });
  });
}
