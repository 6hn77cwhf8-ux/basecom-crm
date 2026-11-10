import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../db/client.js";
import { users } from "../db/schema.js";
import { buildApp } from "../app.js";
import { hashPassword } from "../auth/service.js";
import { currentTotp } from "../auth/totp.js";

const url = process.env.DATABASE_URL;
const KEY = Buffer.alloc(32, 9).toString("base64");

describe.skipIf(!url)("gestão de utilizadores e configurações", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const app = buildApp({ db, encryptionKey: KEY });
  const tag = Date.now();
  const adminEmail = `adm-${tag}@basecom.pt`;
  const created: string[] = [adminEmail];

  async function signIn(email: string, password: string) {
    const r1 = (await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } })).json();
    const secret = r1.secret as string;
    const r2 = (await app.inject({ method: "POST", url: "/auth/totp", payload: { challengeToken: r1.challengeToken, code: currentTotp(secret, email) } })).json();
    return r2.token as string;
  }
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  let adminToken = "";
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
    await db.insert(users).values({ name: "Adm", email: adminEmail, role: "admin", passwordHash: await hashPassword("Provisoria-1"), mustChangePassword: false });
    adminToken = await signIn(adminEmail, "Provisoria-1");
  });
  afterAll(async () => {
    const ids = (await db.query.users.findMany({ where: inArray(users.email, created) })).map((u) => u.id);
    if (ids.length) {
      for (const t of ["sessions", "auth_challenges", "audit_log"]) await db.execute(sql`delete from ${sql.identifier(t)} where user_id in ${ids}`);
      await db.execute(sql`delete from settings where updated_by in ${ids}`);
      await db.delete(users).where(inArray(users.id, ids));
    }
    await pool.end();
  });

  it("o Administrador cria uma comercial com palavra-passe provisória", async () => {
    const email = `com-${tag}@basecom.pt`; created.push(email);
    const r = await app.inject({ method: "POST", url: "/users", headers: auth(adminToken), payload: { name: "Comercial Teste", email, role: "sales", hiredAt: "2026-11-01" } });
    expect(r.statusCode).toBe(200);
    const temp = r.json().tempPassword as string;
    // Primeira entrada: tem de trocar a palavra-passe antes de usar o CRM
    const t = await signIn(email, temp);
    expect((await app.inject({ method: "GET", url: "/users", headers: auth(t) })).statusCode).toBe(403);
    const curto = await app.inject({ method: "POST", url: "/auth/password", headers: auth(t), payload: { current: temp, next: "curta" } });
    expect(curto.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/auth/password", headers: auth(t), payload: { current: temp, next: "Nova-palavra-2026" } });
    expect(ok.statusCode).toBe(200);
    // Comercial não gere utilizadores
    expect((await app.inject({ method: "POST", url: "/users", headers: auth(t), payload: { name: "X", email: "x@x.pt", role: "sales" } })).statusCode).toBe(403);
  });

  it("não deixa criar dois utilizadores com o mesmo email", async () => {
    const r = await app.inject({ method: "POST", url: "/users", headers: auth(adminToken), payload: { name: "Dup", email: adminEmail, role: "sales" } });
    expect(r.statusCode).toBe(409);
  });

  it("as configurações mudam as regras e ficam na auditoria", async () => {
    const bad = await app.inject({ method: "PUT", url: "/settings/auth", headers: auth(adminToken), payload: { maxFailedLogins: 1, lockMinutes: 15, sessionHours: 12 } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "PUT", url: "/settings/timeLimits", headers: auth(adminToken), payload: { resultSeconds: 20, nextCallSeconds: 10, campaignSwitchMinutes: 2, trainingMinutes: 5, breakMinutes: 24 } });
    expect(ok.statusCode).toBe(200);
    const all = (await app.inject({ method: "GET", url: "/settings", headers: auth(adminToken) })).json();
    expect(all.settings.timeLimits.resultSeconds).toBe(20);
    const audit = (await app.inject({ method: "GET", url: "/audit", headers: auth(adminToken) })).json();
    expect(audit.entries.some((e: { action: string }) => e.action === "configuracao_alterada")).toBe(true);
    // repor o valor aprovado
    await app.inject({ method: "PUT", url: "/settings/timeLimits", headers: auth(adminToken), payload: { resultSeconds: 15, nextCallSeconds: 10, campaignSwitchMinutes: 2, trainingMinutes: 5, breakMinutes: 24 } });
  });

  it("o Administrador não se pode desativar a si próprio", async () => {
    const me = (await app.inject({ method: "GET", url: "/auth/me", headers: auth(adminToken) })).json().user;
    const r = await app.inject({ method: "PATCH", url: `/users/${me.id}`, headers: auth(adminToken), payload: { active: false } });
    expect(r.statusCode).toBe(400);
  });
});
