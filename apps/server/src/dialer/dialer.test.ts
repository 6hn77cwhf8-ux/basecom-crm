import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { campaignEntries, campaigns, companies, companyContacts, opportunities, tasks, users, walletChanges } from "../db/schema.js";
import { toPublic } from "../auth/service.js";
import { createCampaign } from "../campaigns/service.js";
import { endCall, nextEntry, saveResult, startCall, type ResultInput } from "./service.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("Power Dialer: consequências dos resultados", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const tag = String(Date.now()).slice(-6);
  const district = `PD ${tag}`;
  type U = typeof users.$inferSelect;
  let admin: U, ana: U, bia: U;
  const coIds: string[] = [];
  const campIds: string[] = [];
  let campaignId = "";

  async function company(i: number, phones = 1) {
    const [c] = await db.insert(companies).values({ nif: `6${tag}${String(i).padStart(2, "0")}`, name: `Empresa ${tag} ${i}`, nameKey: `empresa ${tag} ${i}`, accountType: "prospect", district }).returning();
    for (let p = 0; p < phones; p++) await db.insert(companyContacts).values({ companyId: c!.id, kind: "phone", value: `9${tag}${i}${p}`, isPrimary: p === 0, personName: p === 0 ? "Maria Silva" : null, salutation: p === 0 ? "Srª" : null });
    coIds.push(c!.id);
    return c!.id;
  }
  /** Simula uma chamada completa a uma empresa da campanha. */
  async function call(u: U, input: ResultInput) {
    const n = await nextEntry(db, toPublic(u), campaignId);
    if (!n) throw new Error("fila vazia");
    const c = await startCall(db, toPublic(u), { companyId: n.company.id, contactId: n.phone?.id, entryId: n.entry.id, source: "new" });
    await endCall(db, toPublic(u), c.id);
    return { n, r: await saveResult(db, toPublic(u), c.id, input) };
  }
  const entryOf = async (companyId: string) => (await db.select().from(campaignEntries).where(and(eq(campaignEntries.companyId, companyId), eq(campaignEntries.campaignId, campaignId))))[0]!;
  const readyNow = (companyId: string) => db.update(campaignEntries).set({ nextAt: null }).where(eq(campaignEntries.companyId, companyId));

  beforeAll(async () => {
    const mk = (n: string, role: "admin" | "sales") => db.insert(users).values({ name: `${n} ${tag}`, email: `${n}-d${tag}@basecom.pt`, role, passwordHash: "x", mustChangePassword: false }).returning().then((r) => r[0]!);
    admin = await mk("adm", "admin"); ana = await mk("ana", "sales"); bia = await mk("bia", "sales");
    for (let i = 0; i < 8; i++) await company(i, i === 1 ? 1 : 2);
    const k = await createCampaign(db, toPublic(admin), { name: `PD ${tag}`, mode: "new", script: "Olá, sou {comercial}. Falo com {decisor1} da {empresa}?", filters: { districts: [district] }, memberIds: [ana.id, bia.id] });
    campaignId = k.id; campIds.push(k.id);
  });
  afterAll(async () => {
    await db.delete(campaigns).where(inArray(campaigns.id, campIds));
    await db.execute(sql`delete from calls where user_id in ${[ana.id, bia.id]}`);
    await db.execute(sql`delete from time_entries where user_id in ${[ana.id, bia.id]}`);
    await db.delete(companies).where(inArray(companies.id, coIds));
    await db.execute(sql`delete from audit_log where user_id in ${[admin.id, ana.id, bia.id]}`);
    await db.delete(users).where(inArray(users.id, [admin.id, ana.id, bia.id]));
    await pool.end();
  });

  it("cada comercial recebe uma empresa diferente e o script vem preenchido", async () => {
    const a = (await nextEntry(db, toPublic(ana), campaignId))!;
    const b = (await nextEntry(db, toPublic(bia), campaignId))!;
    expect(a.company.id).not.toBe(b.company.id);
    expect(a.script).toBe(`Olá, sou ana ${tag}. Falo com Srª Maria Silva da ${a.company.name}?`);
    // A mesma pessoa volta a receber a que tem reservada.
    expect((await nextEntry(db, toPublic(ana), campaignId))!.company.id).toBe(a.company.id);
  });

  it("Não atendeu: +2 h; à 3.ª tentativa do dia passa para o dia seguinte; à 6.ª fica esgotada", async () => {
    const { n } = await call(ana, { outcomeId: "no_answer" });
    let e = await entryOf(n.company.id);
    expect(e.attempts).toBe(1);
    expect(Math.abs(e.nextAt!.getTime() - Date.now() - 2 * 3600_000)).toBeLessThan(15 * 3600_000); // dentro do horário
    for (let i = 0; i < 2; i++) { await readyNow(n.company.id); await call(ana, { outcomeId: "no_answer" }); }
    e = await entryOf(n.company.id);
    expect(e.attempts).toBe(3);
    expect(e.nextAt!.getTime()).toBeGreaterThan(Date.now() + 3600_000); // amanhã
    for (let i = 0; i < 3; i++) { await readyNow(n.company.id); await db.update(campaignEntries).set({ attempts: 5 }).where(eq(campaignEntries.id, e.id)); }
    await readyNow(n.company.id);
    await call(ana, { outcomeId: "no_answer" });
    expect((await entryOf(n.company.id)).status).toBe("exhausted");
  });

  it("Número errado sem outro número: «Sem contacto válido»", async () => {
    // Empresa própria deste teste, com um só número. Liberta reservas e põe as outras para amanhã, só para isolar o caso.
    const solo = await company(90, 1);
    await db.insert(campaignEntries).values({ campaignId, companyId: solo });
    await db.update(campaignEntries).set({ lockedBy: null, lockedUntil: null }).where(eq(campaignEntries.campaignId, campaignId));
    await db.update(campaignEntries).set({ nextAt: new Date(Date.now() + 86400_000) }).where(and(eq(campaignEntries.campaignId, campaignId), sql`company_id <> ${solo}::uuid`, eq(campaignEntries.status, "pending")));
    let n;
    try { ({ n } = await call(bia, { outcomeId: "wrong_number" })); }
    finally { await db.update(campaignEntries).set({ nextAt: null }).where(and(eq(campaignEntries.campaignId, campaignId), eq(campaignEntries.status, "pending"))); }
    expect(n.company.id).toBe(solo);
    expect((await entryOf(solo)).status).toBe("exhausted");
    expect((await db.select().from(companyContacts).where(eq(companyContacts.companyId, solo)))[0]!.status).toBe("incorrect");
  });

  it("Recusa com motivo: sai da campanha e só volta depois do prazo", async () => {
    const { n } = await call(ana, { outcomeId: "not_interested", reasonId: "satisfied" });
    expect((await entryOf(n.company.id)).status).toBe("done");
    const co = (await db.query.companies.findFirst({ where: eq(companies.id, n.company.id) }))!;
    const days = (new Date(co.campaignEligibleFrom!).getTime() - Date.now()) / 86400_000;
    expect(Math.round(days)).toBeGreaterThanOrEqual(89);
    await expect(call(ana, { outcomeId: "not_interested" })).rejects.toThrow(/motivo/);
  });

  it("Callback «Agendar para mim», Interessado e Venda (conquista da carteira)", async () => {
    const at = new Date(Date.now() + 3 * 86400_000).toISOString();
    const { n: n1 } = await call(bia, { outcomeId: "call_later", at, forMe: true, comment: "Ligar à tarde" });
    const e1 = await entryOf(n1.company.id);
    expect(e1.assignedTo).toBe(bia.id);
    expect((await db.select().from(tasks).where(eq(tasks.companyId, n1.company.id)))[0]).toMatchObject({ assignedTo: bia.id, type: "Ligar" });

    const { n: n2 } = await call(ana, { outcomeId: "interested", at, nextAction: "Enviar proposta 4P", services: "4P" });
    expect((await db.select().from(opportunities).where(eq(opportunities.companyId, n2.company.id)))[0]).toMatchObject({ stage: "interest", ownerId: ana.id });

    await (await nextEntry(db, toPublic(ana), campaignId)); // garante a fila
    const { n: n3, r } = await call(ana, { outcomeId: "sale" });
    expect(r.summary).toContain("Empresa conquistada para a sua carteira");
    expect((await db.query.companies.findFirst({ where: eq(companies.id, n3.company.id) }))!.ownerId).toBe(ana.id);
    expect((await db.select().from(walletChanges).where(eq(walletChanges.companyId, n3.company.id)))[0]!.kind).toBe("conquest");
  });

  it("Não contactar: bloqueia e tira de todas as campanhas", async () => {
    const { n } = await call(bia, { outcomeId: "do_not_contact", comment: "Pediu por telefone" });
    expect((await db.query.companies.findFirst({ where: eq(companies.id, n.company.id) }))!.doNotContact).toBe(true);
    expect((await entryOf(n.company.id)).status).toBe("removed");
  });
});
