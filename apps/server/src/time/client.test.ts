import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { companies, companyNotes, notifications, opportunities, tasks, timeEntries, users } from "../db/schema.js";
import { toPublic } from "../auth/service.js";
import { daySummary, endClient, heartbeat, setState, startClient } from "./service.js";

const url = process.env.DATABASE_URL;

/** Decisões de 16 nov 2026: Em cliente (OP obrigatória, sem limite, alerta a cada 10 min), Office (15 min, fecha sozinho), Apoio e Formação só para quem gere. */
describe.skipIf(!url)("em cliente, office, apoio e formação", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const tag = String(Date.now()).slice(-6);
  type U = typeof users.$inferSelect;
  let admin: U, ana: U, coId: string;

  beforeAll(async () => {
    const mk = (n: string, role: "admin" | "sales") => db.insert(users).values({ name: `${n} ${tag}`, email: `${n}-k${tag}@basecom.pt`, role, passwordHash: "x", mustChangePassword: false }).returning().then((r) => r[0]!);
    admin = await mk("adm", "admin"); ana = await mk("ana", "sales");
    const [co] = await db.insert(companies).values({ nif: `6${tag}11`, name: `Cliente ${tag}`, nameKey: `cliente ${tag}`, accountType: "client" }).returning();
    coId = co!.id;
  });
  afterAll(async () => {
    await db.delete(notifications).where(inArray(notifications.aboutUserId, [ana.id]));
    await db.delete(timeEntries).where(inArray(timeEntries.userId, [ana.id, admin.id]));
    await db.delete(companies).where(eq(companies.id, coId));
    await db.execute(sql`delete from audit_log where user_id in (${admin.id}, ${ana.id})`);
    await db.delete(users).where(inArray(users.id, [admin.id, ana.id]));
    await pool.end();
  });

  it("formação e apoio: o comercial não os pode escolher; o Administrador sim", async () => {
    await heartbeat(db, toPublic(ana));
    await expect(setState(db, toPublic(ana), ana.id, "training")).rejects.toThrow(/Chefe de Equipa/);
    await expect(setState(db, toPublic(ana), ana.id, "support")).rejects.toThrow(/Apoio/);
    await setState(db, toPublic(admin), admin.id, "support");
    expect((await daySummary(db, admin.id)).state).toBe("support");
  });

  it("em cliente: OP de 7 algarismos obrigatória; fica na oportunidade e, ao terminar, no histórico com o tempo", async () => {
    await expect(startClient(db, toPublic(ana), { companyId: coId, kind: "proposal", opCode: "12345" })).rejects.toThrow(/7 algarismos/);
    await startClient(db, toPublic(ana), { companyId: coId, kind: "proposal", opCode: "7590457", withOpportunity: true });
    const s = await daySummary(db, ana.id);
    expect(s.state).toBe("client");
    expect(s.client).toMatchObject({ opCode: "7590457", kind: "proposal", nif: `6${tag}11` });
    const [opp] = await db.select().from(opportunities).where(eq(opportunities.companyId, coId));
    expect(opp).toMatchObject({ stage: "proposal", nosOp: "7590457" });

    // Alerta ao Chefe de Equipa (sem equipa: Administrador) a cada 10 min, uma vez por bloco.
    await db.update(timeEntries).set({ startedAt: new Date(Date.now() - 23 * 60_000) }).where(and(eq(timeEntries.userId, ana.id), sql`${timeEntries.endedAt} is null`));
    await heartbeat(db, toPublic(ana));
    await heartbeat(db, toPublic(ana));
    const alerts = await db.select().from(notifications).where(and(eq(notifications.userId, admin.id), eq(notifications.kind, "client_long")));
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.text).toMatch(/há 20 min .* OP 7590457/);

    // «Guardar e fechar»: tipos e valor, canal, próxima ação e data obrigatórios na proposta.
    await expect(endClient(db, toPublic(ana), { saleTypes: { FID: 120, XSell: 45 } })).rejects.toThrow(/canal/);
    await expect(endClient(db, toPublic(ana), { saleTypes: { FID: 120, XSell: 45 }, channel: "WhatsApp" })).rejects.toThrow(/próxima ação/);
    const at = new Date(Date.now() + 2 * 86400_000).toISOString();
    await endClient(db, toPublic(ana), { saleTypes: { FID: 120, XSell: 45 }, channel: "WhatsApp", followUp: "whatsapp", at, comment: "Compara com a MEO" });
    expect((await daySummary(db, ana.id)).state).toBe("working");
    const [o2] = await db.select().from(opportunities).where(eq(opportunities.companyId, coId));
    expect(o2).toMatchObject({ sentChannel: "WhatsApp", proposedValue: "165.00" });
    const t = await db.select().from(tasks).where(eq(tasks.opportunityId, o2!.id));
    expect(t[0]).toMatchObject({ type: "Follow-up WhatsApp" });
    const sent = await db.select().from(companyNotes).where(and(eq(companyNotes.companyId, coId), eq(companyNotes.kind, "note")));
    expect(sent.map((x) => x.text)).toContain("Proposta enviada · OP 7590457 · FID + XSell · 165,00 €/mês · por WhatsApp · Compara com a MEO");
    const notes = await db.select().from(companyNotes).where(and(eq(companyNotes.companyId, coId), eq(companyNotes.kind, "client_work")));
    expect(notes[0]!.text).toBe(`Proposta elaborada · 23 min · OP 7590457 · ana ${tag}`);
  });

  it("office: no limite do dia (15 min) o tempo fecha e passa sozinho a «A trabalhar»", async () => {
    await setState(db, toPublic(ana), ana.id, "office");
    await db.update(timeEntries).set({ startedAt: new Date(Date.now() - 16 * 60_000) }).where(and(eq(timeEntries.userId, ana.id), sql`${timeEntries.endedAt} is null`));
    expect((await daySummary(db, ana.id)).seconds.office).toBe(15 * 60);
    expect(await heartbeat(db, toPublic(ana))).toBe("working");
    await expect(setState(db, toPublic(ana), ana.id, "office")).rejects.toThrow(/Office/);
  });
});
