import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { companies, companyNotes, users } from "../db/schema.js";
import { toPublic } from "../auth/service.js";
import { logMessage } from "./service.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("mensagens rápidas", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const tag = String(Date.now()).slice(-6);
  let ana: typeof users.$inferSelect, coId: string;
  beforeAll(async () => {
    [ana] = await db.insert(users).values({ name: `ana ${tag}`, email: `ana-m${tag}@basecom.pt`, role: "sales", passwordHash: "x", mustChangePassword: false }).returning() as [typeof users.$inferSelect];
    const [co] = await db.insert(companies).values({ nif: `3${tag}55`, name: `Msg ${tag}`, nameKey: `msg ${tag}`, accountType: "prospect" }).returning();
    coId = co!.id;
  });
  afterAll(async () => { await db.delete(companies).where(eq(companies.id, coId)); await db.delete(users).where(inArray(users.id, [ana.id])); await pool.end(); });

  it("WhatsApp fica no histórico; SMS precisa do telemóvel BASECOM ligado e de um número móvel", async () => {
    await logMessage(db, toPublic(ana), coId, { channel: "whatsapp", templateId: "proposal", to: "910000012", text: "Olá" });
    const [n] = await db.select().from(companyNotes).where(eq(companyNotes.companyId, coId));
    expect(n!.text).toBe(`WhatsApp · Proposta enviada · para 910000012 · ana ${tag}`);
    await expect(logMessage(db, toPublic(ana), coId, { channel: "sms", to: "220000012", text: "Olá" })).rejects.toThrow(/móveis/);
    await expect(logMessage(db, toPublic(ana), coId, { channel: "sms", to: "910000012", text: "Olá" })).rejects.toThrow(/sem ligação/);
  });
});
