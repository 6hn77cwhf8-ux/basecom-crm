import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { companies, companyNotes, notifications, opportunities, tasks, timeEntries, users } from "../db/schema.js";
import { toPublic } from "../auth/service.js";
import { callStats, closedToday, daySummary, endClient, giveUpClient, heartbeat, setState, startClient } from "./service.js";

const url = process.env.DATABASE_URL;

/** Decisões de 16 nov 2026: Em cliente (OP obrigatória, sem limite, alerta a cada 10 min), Office (15 min, fecha sozinho), Apoio e Formação só para quem gere. */
describe.skipIf(!url)("em cliente, office, apoio e formação", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const tag = String(Date.now()).slice(-6);
  type U = typeof users.$inferSelect;
  let admin: U, ana: U, coId: string;
  const extra: string[] = [];

  beforeAll(async () => {
    const mk = (n: string, role: "admin" | "sales") => db.insert(users).values({ name: `${n} ${tag}`, email: `${n}-k${tag}@basecom.pt`, role, passwordHash: "x", mustChangePassword: false }).returning().then((r) => r[0]!);
    admin = await mk("adm", "admin"); ana = await mk("ana", "sales");
    const [co] = await db.insert(companies).values({ nif: `6${tag}11`, name: `Cliente ${tag}`, nameKey: `cliente ${tag}`, accountType: "client" }).returning();
    coId = co!.id;
  });
  afterAll(async () => {
    await db.delete(notifications).where(inArray(notifications.aboutUserId, [ana.id]));
    await db.delete(timeEntries).where(inArray(timeEntries.userId, [ana.id, admin.id]));
    await db.delete(companies).where(inArray(companies.id, [coId, ...extra]));
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

  it("23 nov: mudar Proposta↔Venda não recomeça o tempo; só sai a guardar (venda ao cêntimo) ou «Cliente desistiu»; conta no dia", async () => {
    const mkCo = async (k: string) => { const [c] = await db.insert(companies).values({ nif: `6${tag}${k}`, name: `Venda ${k} ${tag}`, nameKey: `venda ${k} ${tag}`, accountType: "client" }).returning(); extra.push(c!.id); return c!.id; };
    const c1 = await mkCo("21"), c2 = await mkCo("22");
    await startClient(db, toPublic(ana), { companyId: c1, kind: "proposal", opCode: "7000021", withOpportunity: true });
    await db.update(opportunities).set({ saleTypes: { NN: 100 }, proposedValue: "100" }).where(eq(opportunities.companyId, c1));
    const open = async () => (await db.select().from(timeEntries).where(and(eq(timeEntries.userId, ana.id), sql`${timeEntries.endedAt} is null`)))[0]!;
    const first = await open();
    await startClient(db, toPublic(ana), { companyId: c1, kind: "sale", opCode: "7000021", withOpportunity: true });
    await startClient(db, toPublic(ana), { companyId: c1, kind: "proposal", opCode: "7000021", withOpportunity: true });
    await startClient(db, toPublic(ana), { companyId: c1, kind: "sale", opCode: "7000021", withOpportunity: true });
    const now = await open();
    expect(now.id).toBe(first.id);
    expect(now.startedAt.getTime()).toBe(first.startedAt.getTime());
    expect(now.workKind).toBe("sale");
    await expect(startClient(db, toPublic(ana), { companyId: c2, kind: "sale", opCode: "7000022" })).rejects.toThrow(/outra empresa/);
    await expect(setState(db, toPublic(ana), ana.id, "break")).rejects.toThrow(/Guardar e fechar/);
    await expect(setState(db, toPublic(ana), ana.id, "working")).rejects.toThrow(/Cliente desistiu/);

    const before = await closedToday(db, ana.id);
    await endClient(db, toPublic(ana), { saleTypes: { NN: 98.5 }, l2b: { monthly: 120, contractMonths: 36 } });
    expect(await db.query.companies.findFirst({ where: eq(companies.id, c1) })).toMatchObject({ l2bMonthly: "120.00", loyaltyMonths: 36 });
    const [won] = await db.select().from(opportunities).where(eq(opportunities.companyId, c1));
    expect(won).toMatchObject({ stage: "won", proposedValue: "100.00", soldValue: "98.50", closedVia: "client" });
    expect((await closedToday(db, ana.id)).won).toBe(before.won + 1);

    await startClient(db, toPublic(ana), { companyId: c2, kind: "proposal", opCode: "7000022", withOpportunity: true });
    const r0 = (await callStats(db, ana.id)).refusals;
    await expect(giveUpClient(db, toPublic(ana), { reasonId: "approach" })).rejects.toThrow(/mensalidade/);
    await giveUpClient(db, toPublic(ana), { reasonId: "approach", l2b: { monthly: 60, monthsLeft: 10 } });
    expect((await daySummary(db, ana.id)).state).toBe("working");
    const [lost] = await db.select().from(opportunities).where(eq(opportunities.companyId, c2));
    expect(lost).toMatchObject({ stage: "lost", lostReasonId: "approach", closedVia: "client" });
    expect((await callStats(db, ana.id)).refusals).toBe(r0 + 1);
    const co2 = (await db.query.companies.findFirst({ where: eq(companies.id, c2) }))!;
    expect(Math.round((new Date(co2.campaignEligibleFrom!).getTime() - Date.now()) / 86_400_000)).toBeGreaterThanOrEqual(119); // Recusa à abordagem: 120 dias
  });

  it("office: no limite do dia (15 min) o tempo fecha e passa sozinho a «A trabalhar»", async () => {
    await setState(db, toPublic(ana), ana.id, "office");
    await db.update(timeEntries).set({ startedAt: new Date(Date.now() - 16 * 60_000) }).where(and(eq(timeEntries.userId, ana.id), sql`${timeEntries.endedAt} is null`));
    expect((await daySummary(db, ana.id)).seconds.office).toBe(15 * 60);
    expect(await heartbeat(db, toPublic(ana))).toBe("working");
    await expect(setState(db, toPublic(ana), ana.id, "office")).rejects.toThrow(/Office/);
  });
});
