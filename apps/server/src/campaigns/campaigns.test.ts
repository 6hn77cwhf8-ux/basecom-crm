import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { campaignEntries, campaigns, companies, companyContacts, users } from "../db/schema.js";
import { toPublic } from "../auth/service.js";
import { createCampaign, listCampaigns, previewCampaign, refreshCampaign, updateCampaign } from "./service.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("campanhas: que empresas entram", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const tag = String(Date.now()).slice(-6);
  const district = `Distrito ${tag}`;
  type U = typeof users.$inferSelect;
  let admin: U, ana: U, bia: U;
  const co: Record<string, string> = {};
  const created: string[] = [];

  async function company(key: string, extra: Partial<typeof companies.$inferInsert> = {}, phone: "valid" | "incorrect" | null = "valid") {
    const [c] = await db.insert(companies).values({ nif: `7${tag}${String(Object.keys(co).length).padStart(2, "0")}`, name: `${key} ${tag}`, nameKey: `${key} ${tag}`, accountType: "prospect", district, ...extra }).returning();
    if (phone) await db.insert(companyContacts).values({ companyId: c!.id, kind: "phone", value: `91${tag}${Object.keys(co).length}`, status: phone });
    co[key] = c!.id;
  }

  beforeAll(async () => {
    const mk = (n: string, role: "admin" | "sales") => db.insert(users).values({ name: `${n} ${tag}`, email: `${n}-c${tag}@basecom.pt`, role, passwordHash: "x", mustChangePassword: false }).returning().then((r) => r[0]!);
    admin = await mk("adm", "admin"); ana = await mk("ana", "sales"); bia = await mk("bia", "sales");
    await company("livre");
    await company("cliente", { accountType: "client" });
    await company("da_ana", { ownerId: ana.id });
    await company("da_bia", { ownerId: bia.id });
    await company("nao_contactar", { doNotContact: true });
    await company("encerrada", { inactive: true });
    await company("em_prazo", { campaignEligibleFrom: "2099-01-01" });
    await company("sem_telefone", {}, null);
    await company("telefone_incorreto", {}, "incorrect");
  });
  afterAll(async () => {
    await db.delete(campaigns).where(inArray(campaigns.id, created));
    await db.delete(companies).where(inArray(companies.id, Object.values(co)));
    await db.execute(sql`delete from audit_log where user_id = ${admin.id}`);
    await db.delete(users).where(inArray(users.id, [admin.id, ana.id, bia.id]));
    await pool.end();
  });

  it("aplica as regras de exclusão e de carteira", async () => {
    const p = await previewCampaign(db, { districts: [district] }, [ana.id]);
    expect(p).toMatchObject({ total: 3, clients: 1, in_wallet: 1 }); // livre, cliente, da_ana
    // Porque ficam de fora: bloqueadas (não contactar, encerrada), em prazo, sem telefone válido (2), outra carteira.
    expect(p).toMatchObject({ matching: 9, blocked: 2, cooldown: 1, no_phone: 2, other_wallet: 1, other_campaign: 0 });

    const { id, added } = await createCampaign(db, toPublic(admin), { name: `Teste ${tag}`, mode: "new", script: "Olá, o meu nome é {comercial}.", filters: { districts: [district] }, memberIds: [ana.id] });
    created.push(id);
    expect(added).toBe(3);
    const entries = await db.select().from(campaignEntries).where(eq(campaignEntries.campaignId, id));
    const byCo = Object.fromEntries(entries.map((e) => [e.companyId, e.assignedTo]));
    expect(byCo[co.livre!]).toBeNull(); // conjunto comum
    expect(byCo[co.da_ana!]).toBe(ana.id); // a carteira da Ana só vai para a Ana
    expect(co.da_bia! in byCo).toBe(false); // outra carteira nunca entra

    // Uma empresa não fica em duas campanhas ativas.
    const again = await previewCampaign(db, { districts: [district] }, [ana.id]);
    expect(again).toMatchObject({ total: 0, other_campaign: 3 });
    // Trazer de outras campanhas: só as que ninguém tem reservadas (a da Ana fica com ela).
    expect((await previewCampaign(db, { districts: [district], takeFromOtherCampaigns: true }, [ana.id])).total).toBe(2);
    const only = await previewCampaign(db, { districts: [district], accountType: "client" }, [bia.id]);
    expect(only.total).toBe(0);
  });

  it("atualizar a lista acrescenta as novas; terminar liberta as pendentes", async () => {
    const id = created[0]!;
    await company("nova");
    expect((await refreshCampaign(db, toPublic(admin), id)).added).toBe(1);
    expect((await refreshCampaign(db, toPublic(admin), id)).added).toBe(0);

    const seenByAna = (await listCampaigns(db, toPublic(ana))).map((c) => (c as { id: string }).id);
    const seenByBia = (await listCampaigns(db, toPublic(bia))).map((c) => (c as { id: string }).id);
    expect(seenByAna).toContain(id);
    expect(seenByBia).not.toContain(id);

    await updateCampaign(db, toPublic(admin), id, { status: "ended" });
    expect((await previewCampaign(db, { districts: [district] }, [ana.id])).total).toBe(4);
  });

  it("valor L2B e meses para o fim da permanência; trazer de outra campanha move as empresas", async () => {
    await company("barata", { l2bMonthly: "30", loyaltyMonths: 5 });
    await company("media", { l2bMonthly: "150", loyaltyMonths: 18 });
    await company("cara", { l2bMonthly: "700", loyaltyMonths: 30 });
    const base = { districts: [district] };
    expect((await previewCampaign(db, { ...base, l2bRanges: [[0, 50], [500, null]] }, [ana.id])).total).toBe(2);
    expect((await previewCampaign(db, { ...base, l2bMin: 100, l2bMax: 200 }, [ana.id])).total).toBe(1);
    expect((await previewCampaign(db, { ...base, loyaltyMonths: ["le9"] }, [ana.id])).total).toBe(1);
    expect((await previewCampaign(db, { ...base, loyaltyMonths: ["le21"] }, [ana.id])).total).toBe(2);
    expect((await previewCampaign(db, { ...base, loyaltyMonths: ["gt21"] }, [ana.id])).total).toBe(1);

    const a = await createCampaign(db, toPublic(admin), { name: `A ${tag}`, mode: "new", script: "", filters: { ...base, l2bMin: 0 }, memberIds: [ana.id] });
    created.push(a.id);
    const b = await createCampaign(db, toPublic(admin), { name: `B ${tag}`, mode: "new", script: "", filters: { ...base, l2bMin: 100, takeFromOtherCampaigns: true }, memberIds: [ana.id] });
    created.push(b.id);
    expect(b.added).toBe(2); // media e cara passaram de A para B
    const inA = await db.select().from(campaignEntries).where(eq(campaignEntries.campaignId, a.id));
    expect(inA.filter((e) => e.status === "pending").length).toBe(1);
  });
});
