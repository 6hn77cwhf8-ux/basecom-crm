import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { calls, campaignEntries, campaigns, companies, companyContacts, companyNotes, users } from "../db/schema.js";
import { toPublic } from "../auth/service.js";
import { createCampaign } from "../campaigns/service.js";
import { companyScriptView, endCall, nextEntry, saveResult, startCall } from "../dialer/service.js";
import { createCompany } from "./create.js";
import { pipelineStats } from "../opportunities/service.js";
import { opportunities } from "../db/schema.js";
import { callStats } from "../time/service.js";
import { editL2B, liftDissatisfied, markFormerClient } from "./status.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("correções de 18/11: ex-cliente, L2B, Insatisfeito NOS, quarentena, religar", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const tag = String(Date.now()).slice(-6);
  const district = `ST ${tag}`;
  type U = typeof users.$inferSelect;
  let admin: U, ana: U;
  const coIds: string[] = [], campIds: string[] = [];
  let kCurrent = "", kFormer = "", kLow = "", kHigh = "";

  async function company(i: number, o: Partial<typeof companies.$inferInsert> = {}, phones = 1) {
    const [c] = await db.insert(companies).values({ nif: `7${tag}${String(i).padStart(2, "0")}`, name: `Est ${tag} ${i}`, nameKey: `est ${tag} ${i}`, accountType: "prospect", district, ...o }).returning();
    for (let p = 0; p < phones; p++) await db.insert(companyContacts).values({ companyId: c!.id, kind: "phone", value: `91${tag}${i}${p}`.slice(0, 9), isPrimary: p === 0 });
    coIds.push(c!.id);
    return c!.id;
  }
  /** NIF válido e único para cada corrida (dígito de controlo certo). */
  const validNif = (p: string) => { const d = p.split("").map(Number); const r = 11 - (d.reduce((a, x, i) => a + x * (9 - i), 0) % 11); return p + (r >= 10 ? 0 : r); };
  const entries = async (coId: string) => (await db.select().from(campaignEntries).where(and(eq(campaignEntries.companyId, coId), eq(campaignEntries.status, "pending")))).map((e) => e.campaignId);

  beforeAll(async () => {
    const mk = (n: string, role: "admin" | "sales") => db.insert(users).values({ name: `${n} ${tag}`, email: `${n}-st${tag}@basecom.pt`, role, passwordHash: "x", mustChangePassword: false }).returning().then((r) => r[0]!);
    admin = await mk("adm", "admin"); ana = await mk("ana", "sales");
  });
  afterAll(async () => {
    await db.delete(campaigns).where(inArray(campaigns.id, campIds));
    await db.execute(sql`delete from calls where user_id in ${[ana.id, admin.id]}`);
    await db.execute(sql`delete from time_entries where user_id in ${[ana.id, admin.id]}`);
    await db.delete(companies).where(inArray(companies.id, coIds));
    await db.execute(sql`delete from wallet_changes where created_by in ${[ana.id, admin.id]}`);
    await db.execute(sql`delete from audit_log where user_id in ${[admin.id, ana.id]}`);
    await db.delete(users).where(inArray(users.id, [admin.id, ana.id]));
    await pool.end();
  });

  it("ex-cliente: perde a carteira, sai da campanha de clientes e entra na de ex-clientes; a importação não volta atrás", async () => {
    const co = await company(1, { accountType: "client", portalStatus: "CLIENTE", ownerId: ana.id, walletKind: "FC", walletKindConfirmed: true });
    kCurrent = (await createCampaign(db, toPublic(admin), { name: `Atuais ${tag}`, mode: "current", script: "", filters: { districts: [district], accountType: "client" }, memberIds: [ana.id] })).id;
    kFormer = (await createCampaign(db, toPublic(admin), { name: `Ex ${tag}`, mode: "new", script: "", filters: { districts: [district], portalStatus: ["EX-CLIENTE"] }, memberIds: [ana.id] })).id;
    campIds.push(kCurrent, kFormer);
    expect(await entries(co)).toEqual([kCurrent]);
    await expect(markFormerClient(db, toPublic(ana), co, "")).rejects.toThrow(/porque/);
    const r = await markFormerClient(db, toPublic(ana), co, "Cancelou os serviços em outubro");
    expect(r).toMatchObject({ left: [kCurrent], joined: [kFormer] });
    const c = (await db.query.companies.findFirst({ where: eq(companies.id, co) }))!;
    expect(c).toMatchObject({ accountType: "prospect", portalStatus: "EX-CLIENTE", ownerId: null });
    expect(c.statusEditedAt).not.toBeNull();
    expect(await entries(co)).toEqual([kFormer]);
  });

  it("L2B corrigido na ficha: fica no histórico e a empresa troca logo de campanha", async () => {
    const co = await company(2, { accountType: "client", l2bMonthly: "200" });
    kLow = (await createCampaign(db, toPublic(admin), { name: `L2B baixo ${tag}`, mode: "current", script: "", filters: { districts: [district], l2bMax: 150 }, memberIds: [ana.id] })).id;
    kHigh = (await createCampaign(db, toPublic(admin), { name: `L2B alto ${tag}`, mode: "current", script: "", filters: { districts: [district], l2bMin: 150 }, memberIds: [ana.id] })).id;
    campIds.push(kLow, kHigh);
    expect(await entries(co)).toContain(kHigh);
    const r = await editL2B(db, toPublic(ana), co, { l2bMonthly: 130, loyaltyMonths: 8 });
    expect(r.left).toContain(kHigh); expect(r.joined).toContain(kLow);
    const notes = await db.select().from(companyNotes).where(eq(companyNotes.companyId, co));
    expect(notes.map((n) => n.text).join()).toMatch(/L2B: 200,00 € → 130,00 € · Meses de permanência: — → 8/);
  });

  it("Insatisfeito NOS: sai de todas as campanhas durante 12 meses; só o Administrador retira antes", async () => {
    const co = await company(3);
    const k = (await createCampaign(db, toPublic(admin), { name: `Ins ${tag}`, mode: "new", script: "", filters: { districts: [district], accountType: "prospect" }, memberIds: [ana.id] })).id;
    campIds.push(k);
    await db.update(campaignEntries).set({ nextAt: new Date(Date.now() + 86400_000) }).where(and(eq(campaignEntries.campaignId, k), sql`company_id <> ${co}::uuid`));
    const n = (await nextEntry(db, toPublic(ana), k))!;
    expect(n.company.id).toBe(co);
    expect(n.firstNoAnswer).toBe(true);
    const c = await startCall(db, toPublic(ana), { companyId: co, contactId: n.phone?.id, entryId: n.entry.id, source: "new" });
    await endCall(db, toPublic(ana), c.id);
    await saveResult(db, toPublic(ana), c.id, { outcomeId: "not_interested", reasonId: "dissatisfied" });
    const row = (await db.query.companies.findFirst({ where: eq(companies.id, co) }))!;
    const months = (new Date(row.dissatisfiedUntil!).getTime() - Date.now()) / (30.4 * 86400_000);
    expect(Math.round(months)).toBe(12);
    expect(await entries(co)).toEqual([]);
    await expect(liftDissatisfied(db, toPublic(ana), co)).rejects.toThrow(/Administrador/);
    await liftDissatisfied(db, toPublic(admin), co);
    expect((await db.query.companies.findFirst({ where: eq(companies.id, co) }))!.dissatisfiedUntil).toBeNull();
  });

  it("religar a mesma empresa antes de guardar: conta como uma chamada e o tempo de registo continua (não recomeça)", async () => {
    const co = await company(4);
    const before = await callStats(db, ana.id);
    const c1 = await startCall(db, toPublic(ana), { companyId: co, source: "ficha" });
    await db.update(calls).set({ startedAt: new Date(Date.now() - 2000), endedAt: new Date(Date.now() - 20_000 + 18_000) }).where(eq(calls.id, c1.id));
    await db.update(calls).set({ endedAt: new Date(Date.now() - 12_000) }).where(eq(calls.id, c1.id));
    const c2 = await startCall(db, toPublic(ana), { companyId: co, source: "ficha" });
    expect(c2.priorResultSeconds).toBeGreaterThanOrEqual(11);
    await db.update(calls).set({ startedAt: new Date(Date.now() - 30_000), endedAt: new Date(Date.now() - 1000) }).where(eq(calls.id, c2.id));
    const r = await saveResult(db, toPublic(ana), c2.id, { outcomeId: "no_answer" });
    expect(r.resultSeconds).toBeGreaterThanOrEqual(12);
    const after = await callStats(db, ana.id);
    expect(after.calls - before.calls).toBe(1);
    expect(after.short - before.short).toBe(1); // a primeira (religada) fica em «chamadas curtas»
  });

  it("recusa dada fora da campanha (ficha/recebida) fecha a empresa em todas as campanhas; fim de fidelização tem de ser futuro", async () => {
    const co = await company(5);
    const k = (await createCampaign(db, toPublic(admin), { name: `Fora ${tag}`, mode: "new", script: "", filters: { districts: [district], accountType: "prospect" }, memberIds: [ana.id] })).id;
    campIds.push(k);
    expect(await entries(co)).toContain(k);
    const c = await startCall(db, toPublic(ana), { companyId: co, source: "ficha" });
    await endCall(db, toPublic(ana), c.id);
    await expect(saveResult(db, toPublic(ana), c.id, { outcomeId: "not_interested", reasonId: "loyal_other", competitor: { operator: "MEO" }, date: new Date().toISOString().slice(0, 10) })).rejects.toThrow(/futura/);
    await saveResult(db, toPublic(ana), c.id, { outcomeId: "not_interested", reasonId: "price" });
    expect(await entries(co)).toEqual([]);
  });

  it("script grande de uma recebida: usa a campanha onde a empresa está; sem campanha, o script por omissão", async () => {
    const co = await company(6);
    const k = (await createCampaign(db, toPublic(admin), { name: `Rec ${tag}`, mode: "new", script: "Olá da campanha {empresa}", filters: { districts: [district], accountType: "prospect" }, memberIds: [ana.id] })).id;
    campIds.push(k);
    const v = await companyScriptView(db, toPublic(ana), co);
    expect(v.campaign.id).toBe(k);
    expect(v.entry.id).not.toBe("");
    const lone = (await createCompany(db, toPublic(ana), { nif: validNif(`5${tag}1`), name: `Sem campanha ${tag}`, kind: "NN", phones: ["912345678"] })).id;
    coIds.push(lone);
    const v2 = await companyScriptView(db, toPublic(ana), lone);
    expect(v2.entry.id).toBe("");
    expect(v2.scripts.opening.length).toBeGreaterThan(10);
  });

  it("criar empresa: NIF válido e sem duplicados; NC fica sem carteira e com NC confirmado", async () => {
    await expect(createCompany(db, toPublic(ana), { nif: "123456788", name: "X", kind: "NN" })).rejects.toThrow(/NIF/);
    const r = await createCompany(db, toPublic(ana), { nif: validNif(`5${tag}2`), name: `Nova ${tag}`, kind: "FC", phones: ["931 000 111"], email: "a@b.pt", decisor: "Sr. Rui Exemplo", l2bMonthly: 80 });
    coIds.push(r.id);
    const c = (await db.query.companies.findFirst({ where: eq(companies.id, r.id) }))!;
    expect(c).toMatchObject({ accountType: "client", walletKind: "FC", walletKindConfirmed: true, ownerId: null });
    expect((await createCompany(db, toPublic(ana), { nif: validNif(`5${tag}2`), name: "Outra", kind: "NN" }))).toEqual({ id: r.id, existed: true });
  });

  it("Pipeline: comercial em pontos, Administrador em € pela Receita NOS", async () => {
    const co = await company(7, { walletKind: "NC" });
    await db.insert(opportunities).values({ companyId: co, ownerId: ana.id, stage: "proposal", saleTypes: { NN: 100 }, proposedValue: "100" });
    const s1 = await pipelineStats(db, toPublic(ana));
    expect(s1.metric).toBe("points");
    expect(s1.byUser.find((u) => u.id === ana.id)).toMatchObject({ open: 1, openValue: 600 });
    const s2 = await pipelineStats(db, toPublic(admin));
    expect(s2.metric).toBe("eur");
    expect(s2.byUser.find((u) => u.id === ana.id)).toMatchObject({ open: 1, openValue: 750 });
  });
});
