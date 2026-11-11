import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { companies, companyContacts, companyNotes, importBatches, users } from "../db/schema.js";
import { commitBase, DEFAULT_MAPPING, listBatchRows, previewBase, revertBatch, uploadBase } from "./base.js";

const url = process.env.DATABASE_URL;
const HEAD = ["NIF da Empresa", "Nome da Empresa", "Tipo de Conta", "Valor L2B (€)", "Contacto 1", "Contacto 2", "Comercial Responsável", "Decisor", "Email", "Código Postal", "Operadora", "Histórico Feedback", "Ciclo de Abordagem", "Fim de Fidelização / Permanência", "Tags"];

/** NIF válido a partir de 8 algarismos (calcula o dígito de controlo). */
function nif(base8: string) {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(base8[i]) * (9 - i);
  const r = sum % 11;
  return base8 + String(r < 2 ? 0 : 11 - r);
}

describe.skipIf(!url)("importação da base de empresas", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const tag = String(Date.now()).slice(-7);
  const seller = `Angela Teste ${tag}`;
  const n = (k: number) => nif(`5${tag.slice(-6)}${k}`);
  let adminId = "";
  let sellerId = "";
  const batches: string[] = [];

  async function file(rows: unknown[][], extra?: { name: string; rows: unknown[][] }) {
    const wb = new ExcelJS.Workbook();
    const nc = wb.addWorksheet("NC"); nc.addRow(HEAD); rows.forEach((r) => nc.addRow(r));
    wb.addWorksheet("Sem contacto").addRow(HEAD);
    if (extra) { const ws = wb.addWorksheet(extra.name); ws.addRow(["Motivo", ...HEAD]); extra.rows.forEach((r) => ws.addRow(r)); }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  beforeAll(async () => {
    const [a] = await db.insert(users).values({ name: `Adm ${tag}`, email: `adm-imp-${tag}@basecom.pt`, role: "admin", passwordHash: "x" }).returning();
    const [s] = await db.insert(users).values({ name: seller, email: `ang-imp-${tag}@basecom.pt`, role: "sales", passwordHash: "x" }).returning();
    adminId = a!.id; sellerId = s!.id;
  });
  afterAll(async () => {
    if (batches.length) {
      const ids = (await db.select({ id: companies.id }).from(companies).where(inArray(companies.batchId, batches))).map((c) => c.id);
      if (ids.length) await db.delete(companies).where(inArray(companies.id, ids));
      await db.execute(sql`delete from audit_log where entity_id in ${batches}`);
      await db.delete(importBatches).where(inArray(importBatches.id, batches));
    }
    await db.execute(sql`delete from audit_log where user_id in ${[adminId, sellerId]}`);
    await db.execute(sql`delete from settings where updated_by = ${adminId}`);
    await db.delete(users).where(inArray(users.id, [adminId, sellerId]));
    await pool.end();
  });

  it("analisa, pré-visualiza, grava e anula um lote seguindo as regras aprovadas", async () => {
    const data = await file([
      [n(1), "Alfa Lda", "Cliente", 105, "962687579", "252622028", seller, "Sr. Paulo Rebelo", "GERAL@ALFA.PT", "4490-585", "VOD", "LIGAR 06/05 || SEM CONTATO", "C11/2026", "2026-10-16", "x"],
      [n(2), "Beta Lda", "Cliente", 50, "912000001", "", "Rute Pereira", "Senhora Ana", "", "4000-001", "ODETE", "", "", "", ""],
      [n(3), "Gama Lda", "Cliente", "", "912000002", "", "Zé Desconhecido", "", "", "", "", "", "", "", ""],
      [n(4), "Delta Lda", "Prospect", "", "912000003", "", seller, "", "", "", "MEO", "", "", "", ""],
      ["123456780", "Erro Lda", "Prospect", "", "912000004", "", "Basecom", "", "", "", "", "", "", "", ""],
      [n(5), "Alfa, Limitada", "Prospect", "", "962687579", "", "Basecom", "", "", "", "", "", "", "", ""],
    ], { name: "A rever", rows: [["fecho 2026", n(6), "Rever Lda"]] });

    const up = await uploadBase(db, adminId, "teste.xlsx", data);
    batches.push(up.id);
    const nc = up.sheets.find((s) => s.name === "NC")!;
    expect(nc).toMatchObject({ rows: 6, validNif: 5, invalidNif: 1, action: "import" });
    expect(up.sheets.find((s) => s.name === "Sem contacto")!.action).toBe("skip");
    expect(up.sheets.find((s) => s.name === "A rever")!.action).toBe("skip"); // só NC e NN por omissão (11 nov)

    const sheets = { ...Object.fromEntries(up.sheets.map((s) => [s.name, s.action])), "A rever": "review" as const };
    const pv = await previewBase(db, adminId, up.id, { sheets, mapping: DEFAULT_MAPPING, limit: null });
    expect(pv.summary.byResult).toEqual({ new: 3, nif_to_verify: 1, review: 2, duplicate_review: 1 });
    const rows = (await listBatchRows(db, up.id, {})).rows;
    const r = (name: string) => rows.find((x) => x.name === name)!;
    expect(r("Alfa Lda")).toMatchObject({ result: "new", owner: seller });
    expect(r("Beta Lda").owner).toContain("ex-comercial");
    expect(r("Gama Lda")).toMatchObject({ result: "review" });
    expect(r("Gama Lda").detail).toContain("Comercial desconhecido");
    expect(r("Delta Lda").owner).toBe("sem carteira"); // todas as NN entram sem carteira
    expect(r("Erro Lda").result).toBe("nif_to_verify");
    expect(r("Alfa, Limitada").result).toBe("duplicate_review"); // mesmo nome e mesmo telefone, NIF diferente
    expect(r("Rever Lda").result).toBe("review");

    const done = await commitBase(db, adminId, up.id);
    expect(done).toMatchObject({ created: 5, updated: 0 });
    const alfa = (await db.select().from(companies).where(eq(companies.nif, n(1))))[0]!;
    expect(alfa).toMatchObject({ ownerId: sellerId, operator: "Vodafone", accountType: "client", walletKind: "NC", l2bMonthly: "105.00", loyaltyEnd: "2026-10-16" });
    const contacts = await db.select().from(companyContacts).where(eq(companyContacts.companyId, alfa.id));
    expect(contacts.map((c) => [c.value, c.phoneType, c.isPrimary])).toEqual(expect.arrayContaining([["962687579", "mobile", true], ["252622028", "landline", false], ["geral@alfa.pt", null, true]]));
    expect(contacts.find((c) => c.value === "962687579")).toMatchObject({ salutation: "Sr.", personName: "Paulo Rebelo" });
    const notes = (await db.select().from(companyNotes).where(eq(companyNotes.companyId, alfa.id))).map((x) => x.text);
    expect(notes).toEqual(expect.arrayContaining(["LIGAR 06/05", "SEM CONTATO", "Abordada na campanha C11/2026"]));
    const beta = (await db.select().from(companies).where(eq(companies.nif, n(2))))[0]!;
    expect(beta.ownerId).toBeNull();
    expect((await db.select().from(companyNotes).where(eq(companyNotes.companyId, beta.id))).map((x) => x.text)).toContain("Nota da coluna Operadora: ODETE");

    // Segunda importação: mesmo NIF atualiza sem mudar a carteira; empresa «Não contactar» fica bloqueada.
    await db.update(companies).set({ doNotContact: true }).where(eq(companies.nif, n(2)));
    const data2 = await file([
      [n(1), "Alfa Nova Lda", "Cliente", 120, "962687579", "912999999", "Basecom", "", "", "", "", "LIGAR 06/05 || NOVO CONTACTO", "", "", ""],
      [n(2), "Beta Lda", "Cliente", 50, "912000009", "", "Basecom", "", "", "", "", "", "", "", ""],
    ]);
    const up2 = await uploadBase(db, adminId, "teste2.xlsx", data2);
    batches.push(up2.id);
    const pv2 = await previewBase(db, adminId, up2.id, { sheets: { NC: "import" }, mapping: DEFAULT_MAPPING, limit: null });
    expect(pv2.summary.byResult).toEqual({ update: 1, blocked: 1 });
    await commitBase(db, adminId, up2.id);
    const alfa2 = (await db.select().from(companies).where(eq(companies.nif, n(1))))[0]!;
    expect(alfa2).toMatchObject({ name: "Alfa Nova Lda", ownerId: sellerId, l2bMonthly: "120.00" });
    expect((await db.select().from(companyContacts).where(eq(companyContacts.companyId, alfa.id))).length).toBe(4);
    const notes2 = (await db.select().from(companyNotes).where(eq(companyNotes.companyId, alfa.id))).map((x) => x.text);
    expect(notes2.filter((t) => t === "LIGAR 06/05").length).toBe(1);
    expect(notes2).toContain("NOVO CONTACTO");

    // Anular o segundo lote repõe os valores; anular o primeiro apaga as empresas que criou.
    await revertBatch(db, adminId, up2.id);
    const alfa3 = (await db.select().from(companies).where(eq(companies.nif, n(1))))[0]!;
    expect(alfa3).toMatchObject({ name: "Alfa Lda", l2bMonthly: "105.00" });
    expect((await db.select().from(companyContacts).where(eq(companyContacts.companyId, alfa.id))).length).toBe(3);
    await revertBatch(db, adminId, up.id);
    expect((await db.select().from(companies).where(eq(companies.batchId, up.id))).length).toBe(0);
  });

  it("o ensaio limita o número de linhas", async () => {
    const data = await file(Array.from({ length: 20 }, (_, i) => [nif(`6${tag.slice(-5)}${String(i).padStart(2, "0")}`), `Ensaio ${i} Lda`, "Prospect", "", `9120001${String(i).padStart(2, "0")}`, "", "Basecom", "", "", "", "", "", "", "", ""]));
    const up = await uploadBase(db, adminId, "ensaio.xlsx", data);
    batches.push(up.id);
    const pv = await previewBase(db, adminId, up.id, { sheets: { NC: "import" }, mapping: DEFAULT_MAPPING, limit: 5 });
    expect(pv.summary.total).toBe(5);
    expect(pv.summary.byResult).toEqual({ new: 5 });
  });
});
