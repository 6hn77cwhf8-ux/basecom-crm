import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { companies, companyContacts, companyNotes, importBatches, users } from "../db/schema.js";
import { editAddress } from "../companies/wallet.js";
import { toPublic } from "../auth/service.js";
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
  it("lê o formato de 47 colunas acordado a 11 nov (RGU, setor, distrito, 2.º decisor, portal)", async () => {
    const H = ["NIF da Empresa", "Nome da Empresa", "Tipo de Conta", "Comercial Responsável", "Valor L2B (€)", "Meses Permanência", "Produto", "Tecnologia",
      "Voz Móvel (VM)", "Dados Móveis (DM)", "TV", "Alarmes", "Contacto 1", "Contactos adicionais", "Título", "Decisor", "Email", "Título 2", "Decisor 2", "Email 2",
      "Concelho", "Distrito", "Setor", "Faturação Anual (€)", "Estado no Portal", "Data Saída NOS", "Campanha NBO"];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("NC"); ws.addRow(H);
    const nn = nif(`7${tag.slice(-6)}1`);
    ws.addRow([nn, "Ómega Lda", "Cliente", seller, 1490, 22, "4P", "FTTH", 3, 0, 1, "", "910865708", "224917506; 912345678", "Srª", "Maria Silva", "geral@omega.pt", "Sr.", "Rui Costa", "", "Maia", "Porto", "Serviços", 150000, "CLIENTE", "2021-10", "SOMA | Upsell — Adicione IF a 1000Mbps"]);
    // Não cruzam: vale o portal NOS (NN com portal CLIENTE → Cliente; Cliente sem comercial com portal PROSPECT → Prospeto).
    const p1 = nif(`7${tag.slice(-6)}2`), p2 = nif(`7${tag.slice(-6)}3`);
    ws.addRow([p1, "Portal Cliente Lda", "Prospect", "", "", "", "", "", "", "", "", "", "910865709", "", "", "", "", "", "", "", "Maia", "Porto", "", "", "CLIENTE", "", ""]);
    ws.addRow([p2, "Portal Prospeto Lda", "Cliente", "", "", "", "", "", "", "", "", "", "910865710", "", "", "", "", "", "", "", "Maia", "Porto", "", "", "PROSPECT", "", ""]);
    wb.addWorksheet("Sem contacto").addRow(H);
    const up = await uploadBase(db, adminId, "formato47.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    batches.push(up.id);
    expect(up.sheets.find((x) => x.name === "NC")!.unknownColumns).toEqual([]);
    expect(up.sheets.find((x) => x.name === "Sem contacto")!.action).toBe("skip");
    await previewBase(db, adminId, up.id, { sheets: { NC: "import" }, mapping: DEFAULT_MAPPING, limit: null });
    await commitBase(db, adminId, up.id);
    const co = (await db.select().from(companies).where(eq(companies.nif, nn)))[0]!;
    expect(co).toMatchObject({ district: "Porto", sector: "Serviços", product: "4P", technology: "FTTH", loyaltyMonths: 22, portalStatus: "CLIENTE", nosExitMonth: "2021-10", nboCampaign: "SOMA | Upsell — Adicione IF a 1000Mbps", annualRevenue: "150000.00", ownerId: sellerId });
    expect(co.rgu).toEqual({ VM: 3, DM: 0, TV: 1 });
    expect((await db.select().from(companies).where(eq(companies.nif, p1)))[0]!.accountType).toBe("client");
    expect((await db.select().from(companies).where(eq(companies.nif, p2)))[0]!.accountType).toBe("prospect");
    const cs = await db.select().from(companyContacts).where(eq(companyContacts.companyId, co.id));
    expect(cs.map((x) => x.value).sort()).toEqual(["224917506", "910865708", "912345678", "Rui Costa", "geral@omega.pt"].sort());
    expect(cs.find((x) => x.value === "910865708")).toMatchObject({ isPrimary: true, salutation: "Srª", personName: "Maria Silva" });
    expect(cs.find((x) => x.kind === "person")).toMatchObject({ salutation: "Sr.", personName: "Rui Costa" });
  });
  it("gravar durante uma nova pré-visualização não deixa o lote incoerente", async () => {
    const data = await file(Array.from({ length: 30 }, (_, i) => [nif(`8${tag.slice(-5)}${String(i).padStart(2, "0")}`), `Corrida ${i} Lda`, "Prospect", "", `9130001${String(i).padStart(2, "0")}`, "", "Basecom", "", "", "", "", "", "", "", ""]));
    const up = await uploadBase(db, adminId, "corrida.xlsx", data);
    batches.push(up.id);
    await previewBase(db, adminId, up.id, { sheets: { NC: "import" }, mapping: DEFAULT_MAPPING, limit: 5 });
    const [p, c] = await Promise.allSettled([
      previewBase(db, adminId, up.id, { sheets: { NC: "import" }, mapping: DEFAULT_MAPPING, limit: null }),
      commitBase(db, adminId, up.id),
    ]);
    const batch = (await db.select().from(importBatches).where(eq(importBatches.id, up.id)))[0]!;
    const created = (await db.select().from(companies).where(eq(companies.batchId, up.id))).length;
    // Qualquer que seja a ordem, o lote fica coerente: o que foi gravado é exatamente a pré-visualização guardada.
    expect(p.status === "fulfilled" || c.status === "fulfilled").toBe(true);
    if (batch.status === "committed") {
      const staged = await db.execute(sql`select count(*)::int as n from import_rows where batch_id = ${up.id} and result in ('new','duplicate_review','nif_to_verify')`);
      expect(created).toBe((staged.rows[0] as { n: number }).n);
      expect(created).toBeGreaterThan(0);
    } else {
      expect(batch.status).toBe("preview");
      expect(created).toBe(0);
    }
  });

  it("o CRM manda: morada editada e contactos confirmados não mudam com a importação; os outros ganham o Contacto 1 como principal", async () => {
    const H = ["NIF da Empresa", "Nome da Empresa", "Tipo de Conta", "Contacto 1", "Decisor", "Morada", "Código Postal", "Concelho", "Distrito"];
    const a = nif(`6${tag.slice(-6)}8`), b = nif(`6${tag.slice(-6)}9`);
    const run = async (rows: unknown[][]) => {
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("NN"); ws.addRow(H); for (const r of rows) ws.addRow(r);
      const up = await uploadBase(db, adminId, `crm-manda-${batches.length}.xlsx`, Buffer.from(await wb.xlsx.writeBuffer()));
      batches.push(up.id);
      await previewBase(db, adminId, up.id, { sheets: { NN: "import" }, mapping: DEFAULT_MAPPING, limit: null });
      await commitBase(db, adminId, up.id);
    };
    await run([[a, "Alfa Lda", "Prospect", "912000001", "Rui Sá", "Rua A 1", "4000-001", "Porto", "Porto"], [b, "Beta Lda", "Prospect", "912000002", "Ana Lopes", "Rua B 2", "4000-002", "Porto", "Porto"]]);
    const ca = (await db.select().from(companies).where(eq(companies.nif, a)))[0]!;
    const cb = (await db.select().from(companies).where(eq(companies.nif, b)))[0]!;
    // Alfa: morada corrigida no CRM e contactos confirmados.
    const admin = (await db.query.users.findFirst({ where: eq(users.id, adminId) }))!;
    await editAddress(db, toPublic(admin), ca.id, { address: "Avenida Nova 10", postalCode: "4100-100" });
    await db.update(companies).set({ contactsLockedAt: new Date() }).where(eq(companies.id, ca.id));
    // Nova importação com morada e telefone diferentes nas duas.
    await run([[a, "Alfa Lda", "Prospect", "913000001", "Outro Nome", "Rua Velha 9", "4999-999", "Gaia", "Porto"], [b, "Beta Lda", "Prospect", "913000002", "Carla Dias", "Rua B 3", "4000-003", "Porto", "Porto"]]);
    const ca2 = (await db.select().from(companies).where(eq(companies.id, ca.id)))[0]!;
    expect(ca2).toMatchObject({ address: "Avenida Nova 10", postalCode: "4100-100", municipality: "Porto" });
    const pa = await db.select().from(companyContacts).where(eq(companyContacts.companyId, ca.id));
    expect(pa.map((x) => x.value)).toEqual(["912000001"]); // nada de novo nos contactos confirmados
    const cb2 = (await db.select().from(companies).where(eq(companies.id, cb.id)))[0]!;
    expect(cb2).toMatchObject({ address: "Rua B 3", postalCode: "4000-003" });
    const pb = await db.select().from(companyContacts).where(eq(companyContacts.companyId, cb.id));
    expect(pb.find((x) => x.isPrimary)).toMatchObject({ value: "913000002", personName: "Carla Dias" });
    expect(pb.find((x) => x.value === "912000002")!.isPrimary).toBe(false);
  });
});
