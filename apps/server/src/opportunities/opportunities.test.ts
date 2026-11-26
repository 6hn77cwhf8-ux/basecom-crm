import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { companies, opportunities, tasks, users, walletChanges } from "../db/schema.js";
import { toPublic } from "../auth/service.js";
import { createOpportunity, docsReminders, listOpportunities, logOpportunityActivity, loseOpportunity, moveOpportunity, openProposalPoints, winOpportunity } from "./service.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("Oportunidades", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const tag = String(Date.now()).slice(-6);
  type U = typeof users.$inferSelect;
  let ana: U, bia: U;
  const ids: string[] = [];
  const co = async (i: number) => { const [c] = await db.insert(companies).values({ nif: `4${tag}2${i}`, name: `Opo ${tag} ${i}`, nameKey: `opo ${tag} ${i}`, accountType: "prospect" }).returning(); ids.push(c!.id); return c!.id; };

  beforeAll(async () => {
    const mk = (n: string) => db.insert(users).values({ name: `${n} ${tag}`, email: `${n}-o${tag}@basecom.pt`, role: "sales", passwordHash: "x", mustChangePassword: false }).returning().then((r) => r[0]!);
    ana = await mk("ana"); bia = await mk("bia");
  });
  afterAll(async () => {
    await db.delete(companies).where(inArray(companies.id, ids));
    await db.execute(sql`delete from audit_log where user_id in ${[ana.id, bia.id]}`);
    await db.delete(users).where(inArray(users.id, [ana.id, bia.id]));
    await pool.end();
  });

  it("regra dos sete dias: alerta ao 5.º dia, atrasada ao 7.º; uma atividade recomeça a contagem", async () => {
    const c = await co(1);
    const o = await createOpportunity(db, toPublic(ana), { companyId: c, services: "4P" });
    await expect(createOpportunity(db, toPublic(ana), { companyId: c })).rejects.toThrow(/já tem/);
    await db.update(opportunities).set({ lastActivityAt: new Date(Date.now() - 5 * 86_400_000) }).where(eq(opportunities.id, o.id));
    expect((await listOpportunities(db, toPublic(ana))).find((x) => x.id === o.id)!.alert!.level).toBe("warn");
    await db.update(opportunities).set({ lastActivityAt: new Date(Date.now() - 7 * 86_400_000) }).where(eq(opportunities.id, o.id));
    expect((await listOpportunities(db, toPublic(ana))).find((x) => x.id === o.id)!.alert!.level).toBe("late");
    expect((await listOpportunities(db, toPublic(bia))).find((x) => x.id === o.id)).toBeUndefined();
    // 23 nov: a partir de «Proposta enviada» a OP é obrigatória.
    await expect(moveOpportunity(db, toPublic(ana), o.id, "proposal", "Enviada por email")).rejects.toThrow(/OP/);
    await expect(moveOpportunity(db, toPublic(ana), o.id, "proposal", undefined, "12345")).rejects.toThrow(/7 algarismos/);
    await moveOpportunity(db, toPublic(ana), o.id, "survey");
    await moveOpportunity(db, toPublic(ana), o.id, "proposal", "Enviada por email", "7123456");
    const after = (await listOpportunities(db, toPublic(ana))).find((x) => x.id === o.id)!;
    expect(after).toMatchObject({ stage: "proposal", alert: { level: "ok" } });
    await logOpportunityActivity(db, toPublic(ana), o.id, "Cliente pediu ajuste de preço");
    await expect(moveOpportunity(db, toPublic(bia), o.id, "negotiation")).rejects.toThrow(/não encontrada/);
  });

  it("ganha conquista a carteira; perdida exige motivo e só volta às campanhas depois do prazo", async () => {
    const c1 = await co(2), c2 = await co(3);
    const won = await createOpportunity(db, toPublic(ana), { companyId: c1 });
    // 23 nov: ganha pede a OP e o valor da venda ao cêntimo (pode ser diferente da proposta).
    await expect(winOpportunity(db, toPublic(ana), won.id, { soldTypes: { NN: 98 } })).rejects.toThrow(/OP/);
    await expect(winOpportunity(db, toPublic(ana), won.id, { soldTypes: {}, nosOp: "7000001" })).rejects.toThrow();
    await expect(winOpportunity(db, toPublic(ana), won.id, { soldTypes: { NN: 98 }, nosOp: "7000001", l2b: { monthly: 110 } })).rejects.toThrow(/24 ou 36/);
    await winOpportunity(db, toPublic(ana), won.id, { soldTypes: { NN: 98.004 }, nosOp: "7000001", l2b: { monthly: 110, contractMonths: 24 } });
    expect(await db.query.companies.findFirst({ where: eq(companies.id, c1) })).toMatchObject({ l2bMonthly: "110.00", loyaltyMonths: 24 });
    expect(await db.query.opportunities.findFirst({ where: eq(opportunities.id, won.id) })).toMatchObject({ stage: "won", soldValue: "98.00", soldTypes: { NN: 98 }, closedVia: "pipeline", closedBy: ana.id });
    expect((await db.query.companies.findFirst({ where: eq(companies.id, c1) }))!.ownerId).toBe(ana.id);
    expect((await db.select().from(walletChanges).where(eq(walletChanges.companyId, c1)))[0]!.kind).toBe("conquest");
    await expect(winOpportunity(db, toPublic(ana), won.id, { soldTypes: { NN: 98 } })).rejects.toThrow(/fechada/);

    const lost = await createOpportunity(db, toPublic(ana), { companyId: c2 });
    await expect(loseOpportunity(db, toPublic(ana), lost.id, "inexistente")).rejects.toThrow(/motivo/);
    await expect(loseOpportunity(db, toPublic(ana), lost.id, "loyal_other")).rejects.toThrow(/operadora/);
    await loseOpportunity(db, toPublic(ana), lost.id, "loyal_other", undefined, { operator: "Vodafone", date: "2028-01-31" });
    expect((await db.query.companies.findFirst({ where: eq(companies.id, c2) }))).toMatchObject({ campaignEligibleFrom: "2027-09-30", operator: "Vodafone", loyaltyEnd: "2028-01-31" });
    const c3 = await co(4);
    const lost2 = await createOpportunity(db, toPublic(ana), { companyId: c3 });
    await loseOpportunity(db, toPublic(ana), lost2.id, "price");
    // 25 nov: «Fidelizado recentemente»: contrato 24/36 e meses que faltam; liga 8 meses depois do início do contrato.
    const c4 = await co(5);
    const lost3 = await createOpportunity(db, toPublic(ana), { companyId: c4 });
    await expect(loseOpportunity(db, toPublic(ana), lost3.id, "recent_nos", undefined, undefined, "pipeline", { monthly: 80, monthsLeft: 34 })).rejects.toThrow(/24 ou 36/);
    await loseOpportunity(db, toPublic(ana), lost3.id, "recent_nos", undefined, undefined, "pipeline", { monthly: 80, contractMonths: 36, monthsLeft: 34 });
    const c4row = (await db.query.companies.findFirst({ where: eq(companies.id, c4) }))!;
    expect(c4row).toMatchObject({ l2bMonthly: "80.00", loyaltyMonths: 34 });
    const inMonths = Math.round((new Date(c4row.campaignEligibleFrom!).getTime() - Date.now()) / (30.44 * 86_400_000));
    expect(inMonths).toBe(6);
    const days = (new Date((await db.query.companies.findFirst({ where: eq(companies.id, c3) }))!.campaignEligibleFrom!).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBeGreaterThanOrEqual(89); // motivo «Preço»: 90 dias
  });

  it("«Aguarda docs» há 2 dias cria uma única tarefa «Pedir documentos»; a previsão de pontos soma as propostas abertas", async () => {
    const c = await co(9);
    const o = await createOpportunity(db, toPublic(ana), { companyId: c });
    await moveOpportunity(db, toPublic(ana), o.id, "documents", undefined, "7000009");
    expect(await docsReminders(db, ana.id)).toBe(0); // ainda não passaram 2 dias
    await db.update(opportunities).set({ stageChangedAt: new Date(Date.now() - 2 * 86_400_000 - 60_000) }).where(eq(opportunities.id, o.id));
    expect(await docsReminders(db, ana.id)).toBe(1);
    expect(await docsReminders(db, ana.id)).toBe(0); // não repete
    const [t] = await db.select().from(tasks).where(eq(tasks.opportunityId, o.id));
    expect(t).toMatchObject({ type: "Pedir documentos", assignedTo: ana.id });

    const before = await openProposalPoints(db, ana.id);
    await db.update(opportunities).set({ saleTypes: { FID: 129.9, XSell: 35.5 } }).where(eq(opportunities.id, o.id));
    expect(await openProposalPoints(db, ana.id)).toBe(before + 236);
    await db.delete(tasks).where(eq(tasks.opportunityId, o.id));
  });
});
