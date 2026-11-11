import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { auditLog, companies, companyContacts, users, walletChanges } from "../db/schema.js";
import { toPublic } from "../auth/service.js";
import { applyDueWalletChanges, auditForeignView, cancelScheduled, cycleStart, listScheduled, scheduleTransfer, setContactStatus, setDoNotContact, setWalletKind } from "./wallet.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("carteiras", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const tag = String(Date.now()).slice(-6);
  type U = typeof users.$inferSelect;
  let admin: U, ana: U, bia: U;
  const ids: string[] = [];

  beforeAll(async () => {
    const mk = (name: string, role: "admin" | "sales") => db.insert(users).values({ name: `${name} ${tag}`, email: `${name.toLowerCase()}-w${tag}@basecom.pt`, role, passwordHash: "x", mustChangePassword: false }).returning().then((r) => r[0]!);
    admin = await mk("Adm", "admin"); ana = await mk("Ana", "sales"); bia = await mk("Bia", "sales");
    for (let i = 0; i < 3; i++) {
      const [c] = await db.insert(companies).values({ nif: `8${tag}0${i}`, name: `Carteira ${tag} ${i}`, nameKey: `carteira ${tag} ${i}`, accountType: "client", ownerId: i === 0 ? ana.id : null }).returning();
      ids.push(c!.id);
    }
  });
  afterAll(async () => {
    await db.delete(companies).where(inArray(companies.id, ids));
    await db.execute(sql`delete from audit_log where user_id in ${[admin.id, ana.id, bia.id]}`);
    await db.delete(users).where(inArray(users.id, [admin.id, ana.id, bia.id]));
    await pool.end();
  });

  it("só o Administrador transfere, sempre com justificação", async () => {
    await expect(scheduleTransfer(db, toPublic(ana), { companyIds: [ids[1]!], toOwnerId: ana.id, when: "current", reason: "porque sim" })).rejects.toThrow(/Só o Administrador/);
    await expect(scheduleTransfer(db, toPublic(admin), { companyIds: [ids[1]!], toOwnerId: ana.id, when: "current", reason: "" })).rejects.toThrow(/justificação/);
  });

  it("a partir do ciclo atual aplica logo; a partir do próximo fica agendada até ao início do ciclo", async () => {
    const r1 = await scheduleTransfer(db, toPublic(admin), { companyIds: [ids[1]!], toOwnerId: bia.id, when: "current", reason: "Cliente acompanhado pela Bia" });
    expect(r1.applied).toBeGreaterThanOrEqual(1);
    expect((await db.query.companies.findFirst({ where: eq(companies.id, ids[1]!) }))!.ownerId).toBe(bia.id);

    const r2 = await scheduleTransfer(db, toPublic(admin), { companyIds: [ids[0]!, ids[2]!], toOwnerId: bia.id, when: "next", reason: "Redistribuição de carteiras" });
    expect(r2.effectiveFrom).toBe(cycleStart("next").date);
    expect((await db.query.companies.findFirst({ where: eq(companies.id, ids[0]!) }))!.ownerId).toBe(ana.id);
    expect((await listScheduled(db)).filter((x) => ids.includes(x.companyId))).toHaveLength(2);

    // Cancelar uma das agendadas; a outra aplica-se quando o ciclo começa.
    const sched = (await listScheduled(db)).find((x) => x.companyId === ids[2]!)!;
    await cancelScheduled(db, toPublic(admin), sched.id);
    await applyDueWalletChanges(db, new Date(`${r2.effectiveFrom}T08:00:00Z`));
    expect((await db.query.companies.findFirst({ where: eq(companies.id, ids[0]!) }))!.ownerId).toBe(bia.id);
    expect((await db.query.companies.findFirst({ where: eq(companies.id, ids[2]!) }))!.ownerId).toBeNull();
    const hist = await db.select().from(walletChanges).where(eq(walletChanges.companyId, ids[0]!));
    expect(hist.map((h) => [h.kind, h.status, h.fromOwnerId])).toEqual([["transfer", "applied", ana.id]]);
  });

  it("devolver a «sem carteira» e alterar NC/FC seguem a matriz", async () => {
    await scheduleTransfer(db, toPublic(admin), { companyIds: [ids[1]!], toOwnerId: null, when: "current", reason: "Comercial saiu da empresa" });
    expect((await db.query.companies.findFirst({ where: eq(companies.id, ids[1]!) }))!.ownerId).toBeNull();

    await expect(setWalletKind(db, toPublic(ana), ids[0]!, "FC", "Cliente partilhado")).rejects.toThrow(/responsável/); // já é da Bia
    await setWalletKind(db, toPublic(bia), ids[0]!, "FC", "Cliente partilhado com outro parceiro");
    expect((await db.query.companies.findFirst({ where: eq(companies.id, ids[0]!) }))!.walletKind).toBe("FC");
  });

  it("«Não contactar»: todos marcam, só o Administrador retira; contactos incorretos; auditoria", async () => {
    await setDoNotContact(db, toPublic(ana), ids[0]!, true, "Pediu para não ser contactado");
    await expect(setDoNotContact(db, toPublic(ana), ids[0]!, false, "engano")).rejects.toThrow(/Só o Administrador/);
    await setDoNotContact(db, toPublic(admin), ids[0]!, false, "Oposição retirada por escrito");

    const [ct] = await db.insert(companyContacts).values({ companyId: ids[0]!, kind: "phone", value: `91${tag}1` }).returning();
    await expect(setContactStatus(db, toPublic(ana), ct!.id, "incorrect")).rejects.toThrow(/responsável/);
    await setContactStatus(db, toPublic(bia), ct!.id, "incorrect");
    expect((await db.query.companyContacts.findFirst({ where: eq(companyContacts.id, ct!.id) }))!.status).toBe("incorrect");

    await auditForeignView(db, toPublic(ana), ids[0]!, bia.id);
    await auditForeignView(db, toPublic(bia), ids[0]!, bia.id);
    const views = await db.select().from(auditLog).where(and(eq(auditLog.action, "consulta_outra_carteira"), eq(auditLog.entityId, ids[0]!)));
    expect(views.map((v) => v.userId)).toEqual([ana.id]);
  });
});
