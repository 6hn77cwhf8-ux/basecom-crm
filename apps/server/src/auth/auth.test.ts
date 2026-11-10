/**
 * Testes do login com 2FA contra um PostgreSQL real.
 * Precisam de DATABASE_URL (local: docker compose up -d db; no GitHub: serviço postgres).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../db/client.js";
import { users } from "../db/schema.js";
import { buildApp } from "../app.js";
import { hashPassword } from "./service.js";
import { currentTotp } from "./totp.js";

const url = process.env.DATABASE_URL;
const KEY = Buffer.alloc(32, 7).toString("base64");

describe.skipIf(!url)("login com 2FA (Microsoft Authenticator)", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const app = buildApp({ db, encryptionKey: KEY });
  const email = `teste-${Date.now()}@basecom.pt`;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
    await db.insert(users).values({ name: "Teste", email, role: "sales", passwordHash: await hashPassword("Correta-123") });
  });
  afterAll(async () => {
    await db.execute(sql`delete from sessions where user_id in (select id from users where email = ${email})`);
    await db.execute(sql`delete from auth_challenges where user_id in (select id from users where email = ${email})`);
    await db.execute(sql`delete from audit_log where user_id in (select id from users where email = ${email})`);
    await db.execute(sql`delete from users where email = ${email}`);
    await pool.end();
  });

  const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });

  it("recusa palavra-passe errada com mensagem genérica", async () => {
    const r = await post("/auth/login", { email, password: "errada" });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe("Email ou palavra-passe incorretos.");
  });

  let secret = "";
  it("na primeira entrada pede para ativar a 2FA e mostra o QR", async () => {
    const r = await post("/auth/login", { email, password: "Correta-123" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.step).toBe("enroll");
    expect(b.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    secret = b.secret;
    const wrong = await post("/auth/totp", { challengeToken: b.challengeToken, code: "000000" });
    expect(wrong.statusCode).toBe(401);
    const ok = await post("/auth/totp", { challengeToken: b.challengeToken, code: currentTotp(secret, email), device: "teste" });
    expect(ok.statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${ok.json().token}` } });
    expect(me.json().user.email).toBe(email);
  });

  it("nas entradas seguintes pede só o código", async () => {
    const r = await post("/auth/login", { email, password: "Correta-123" });
    expect(r.json().step).toBe("totp");
    const ok = await post("/auth/totp", { challengeToken: r.json().challengeToken, code: currentTotp(secret, email) });
    expect(ok.statusCode).toBe(200);
    const token = ok.json().token;
    await app.inject({ method: "POST", url: "/auth/logout", headers: { authorization: `Bearer ${token}` } });
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(401);
  });

  it("um código de 2FA não serve duas vezes no mesmo pedido", async () => {
    const r = await post("/auth/login", { email, password: "Correta-123" });
    const c = r.json().challengeToken;
    await post("/auth/totp", { challengeToken: c, code: currentTotp(secret, email) });
    const again = await post("/auth/totp", { challengeToken: c, code: currentTotp(secret, email) });
    expect(again.statusCode).toBe(401);
  });

  it("bloqueia a conta depois de 5 palavras-passe erradas", async () => {
    for (let i = 0; i < 5; i++) await post("/auth/login", { email, password: "errada" });
    const r = await post("/auth/login", { email, password: "Correta-123" });
    expect(r.statusCode).toBe(423);
  });
});
