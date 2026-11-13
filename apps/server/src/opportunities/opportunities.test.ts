import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { companies, opportunities, users, walletChanges } from "../db/schema.js";
import { toPublic } from "../auth/service.js";
import { createOpportunity, listOpportunities, logOpportunityActivity, loseOpportunity, moveOpportunity, winOpportunity } from "./service.js";

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
    await moveOpportunity(db, toPublic(ana), o.id, "proposal", "Enviada por email");
    const after = (await listOpportunities(db, toPublic(ana))).find((x) => x.id === o.id)!;
    expect(after).toMatchObject({ stage: "proposal", alert: { level: "ok" } });
    await logOpportunityActivity(db, toPublic(ana), o.id, "Cliente pediu ajuste de preço");
    await expect(moveOpportunity(db, toPublic(bia), o.id, "negotiation")).rejects.toThrow(/não encontrada/);
  });

  it("ganha conquista a carteira; perdida exige motivo e só volta às campanhas depois do prazo", async () => {
    const c1 = await co(2), c2 = await co(3);
    const won = await createOpportunity(db, toPublic(ana), { companyId: c1 });
    await winOpportunity(db, toPublic(ana), won.id);
    expect((await db.query.companies.findFirst({ where: eq(companies.id, c1) }))!.ownerId).toBe(ana.id);
    expect((await db.select().from(walletChanges).where(eq(walletChanges.companyId, c1)))[0]!.kind).toBe("conquest");
    await expect(winOpportunity(db, toPublic(ana), won.id)).rejects.toThrow(/fechada/);

    const lost = await createOpportunity(db, toPublic(ana), { companyId: c2 });
    await expect(loseOpportunity(db, toPublic(ana), lost.id, "inexistente")).rejects.toThrow(/motivo/);
    await expect(loseOpportunity(db, toPublic(ana), lost.id, "loyal_other")).rejects.toThrow(/operadora/);
    await loseOpportunity(db, toPublic(ana), lost.id, "loyal_other", undefined, { operator: "Vodafone", date: "2028-01-31" });
    expect((await db.query.companies.findFirst({ where: eq(companies.id, c2) }))).toMatchObject({ campaignEligibleFrom: "2027-09-30", operator: "Vodafone", loyaltyEnd: "2028-01-31" });
    const c3 = await co(4);
    const lost2 = await createOpportunity(db, toPublic(ana), { companyId: c3 });
    await loseOpportunity(db, toPublic(ana), lost2.id, "price");
    const days = (new Date((await db.query.companies.findFirst({ where: eq(companies.id, c3) }))!.campaignEligibleFrom!).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBeGreaterThanOrEqual(89); // motivo «Preço»: 90 dias
  });
});
