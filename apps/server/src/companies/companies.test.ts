import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { companies, companyContacts, companyNotes, sessions, users } from "../db/schema.js";
import { buildApp } from "../app.js";
import { newToken } from "../auth/crypto.js";
import { normalizeCompanyName } from "@basecom/shared";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("empresas: lista, pesquisa e ficha", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const app = buildApp({ db, encryptionKey: Buffer.alloc(32, 3).toString("base64") });
  const tag = String(Date.now()).slice(-6);
  let token = "", userId = "", coId = "";
  const nif = `9${tag}01`;

  beforeAll(async () => {
    const [u] = await db.insert(users).values({ name: `Vendedora ${tag}`, email: `v-${tag}@basecom.pt`, role: "sales", passwordHash: "x", mustChangePassword: false }).returning();
    userId = u!.id;
    const t = newToken();
    token = t.token;
    await db.insert(sessions).values({ tokenHash: t.hash, userId, expiresAt: new Date(Date.now() + 3600_000) });
    const [c] = await db.insert(companies).values({ nif, name: `Zeta Clínica ${tag} Lda`, nameKey: normalizeCompanyName(`Zeta Clínica ${tag} Lda`), accountType: "client", municipality: `Concelho ${tag}`, ownerId: userId }).returning();
    coId = c!.id;
    await db.insert(companyContacts).values([
      { companyId: coId, kind: "phone", value: `91${tag}9`, phoneType: "mobile", isPrimary: true, personName: `Decisora ${tag}`, salutation: "Senhora" },
      { companyId: coId, kind: "email", value: `geral${tag}@zeta.pt` },
    ]);
    await db.insert(companyNotes).values({ companyId: coId, kind: "feedback", text: "LIGAR MAIS TARDE" });
  });
  afterAll(async () => {
    await db.delete(companies).where(inArray(companies.id, [coId]));
    await db.execute(sql`delete from sessions where user_id = ${userId}`);
    await db.delete(users).where(inArray(users.id, [userId]));
    await pool.end();
  });
  const get = (u: string) => app.inject({ method: "GET", url: u, headers: { authorization: `Bearer ${token}` } });

  it("encontra a empresa por NIF, telefone, nome e decisor", async () => {
    for (const q of [nif, `91${tag}9`, `zeta clinica ${tag}`, `ZETA CLÍNICA ${tag}`, `Decisora ${tag}`, `geral${tag}`]) {
      const r = (await get(`/search?q=${encodeURIComponent(q)}`)).json();
      expect(r.results.map((x: { id: string }) => x.id), q).toContain(coId);
    }
  });

  it("filtra a lista e devolve a ficha com contactos e histórico", async () => {
    const l = (await get(`/companies?municipality=${encodeURIComponent(`Concelho ${tag}`)}&owner=${userId}&accountType=client`)).json();
    expect(l.total).toBe(1);
    expect(l.rows[0]).toMatchObject({ nif, owner: `Vendedora ${tag}`, walletKind: "NC" });
    expect((await get(`/companies?municipality=${encodeURIComponent(`Concelho ${tag}`)}&owner=none`)).json().total).toBe(0);
    const f = (await get(`/companies/${coId}`)).json();
    expect(f.company).toMatchObject({ nif, owner: `Vendedora ${tag}` });
    expect(f.company.nameKey).toBeUndefined();
    expect(f.contacts).toHaveLength(2);
    expect(f.notes[0].text).toBe("LIGAR MAIS TARDE");
    expect((await get("/companies/kpis")).json().total).toBeGreaterThanOrEqual(1);
  });

  it("pede sessão", async () => {
    expect((await app.inject({ method: "GET", url: "/companies" })).statusCode).toBe(401);
  });
});
