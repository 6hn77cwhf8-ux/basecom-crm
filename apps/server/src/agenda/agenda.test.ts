import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { calls, companies, companyContacts, companyNotes, users } from "../db/schema.js";
import { toPublic } from "../auth/service.js";
import { callFromTask, closeTask, createTask, listAgenda, myDay, rescheduleTask } from "./service.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("Agenda", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const tag = String(Date.now()).slice(-6);
  type U = typeof users.$inferSelect;
  let admin: U, ana: U, bia: U, coId = "";

  beforeAll(async () => {
    const mk = (n: string, role: "admin" | "sales") => db.insert(users).values({ name: `${n} ${tag}`, email: `${n}-a${tag}@basecom.pt`, role, passwordHash: "x", mustChangePassword: false }).returning().then((r) => r[0]!);
    admin = await mk("adm", "admin"); ana = await mk("ana", "sales"); bia = await mk("bia", "sales");
    const [c] = await db.insert(companies).values({ nif: `5${tag}11`, name: `Agenda ${tag}`, nameKey: `agenda ${tag}`, accountType: "prospect" }).returning();
    coId = c!.id;
    await db.insert(companyContacts).values({ companyId: coId, kind: "phone", value: `91${tag}1`, isPrimary: true });
  });
  afterAll(async () => {
    await db.delete(calls).where(eq(calls.companyId, coId));
    await db.delete(companies).where(eq(companies.id, coId));
    await db.execute(sql`delete from time_entries where user_id in ${[ana.id, bia.id]}`);
    await db.execute(sql`delete from audit_log where user_id in ${[admin.id, ana.id, bia.id]}`);
    await db.delete(users).where(inArray(users.id, [admin.id, ana.id, bia.id]));
    await pool.end();
  });

  it("cada comercial vê só as suas tarefas; o Administrador vê as de todos", async () => {
    const due = new Date(Date.now() + 3600_000).toISOString();
    const t = await createTask(db, toPublic(ana), { companyId: coId, type: "Ligar", dueAt: due, description: "Ligar ao Rui" });
    await expect(createTask(db, toPublic(ana), { companyId: coId, type: "Inventado", dueAt: due })).rejects.toThrow(/Tipo/);
    expect((await listAgenda(db, toPublic(ana))).map((x) => x.id)).toContain(t.id);
    expect((await listAgenda(db, toPublic(bia))).map((x) => x.id)).not.toContain(t.id);
    expect((await listAgenda(db, toPublic(admin), { userId: ana.id })).find((x) => x.id === t.id)).toMatchObject({ phone: `91${tag}1`, company: `Agenda ${tag}` });
  });

  it("reagendar exige justificação e fica no histórico; ligar da Agenda cria a chamada; concluir fecha", async () => {
    const [t] = await listAgenda(db, toPublic(ana));
    const later = new Date(Date.now() + 2 * 86400_000).toISOString();
    await expect(rescheduleTask(db, toPublic(ana), t!.id, later, "")).rejects.toThrow(/justificação/);
    await expect(rescheduleTask(db, toPublic(bia), t!.id, later, "Cliente pediu")).rejects.toThrow(/não encontrada/);
    await rescheduleTask(db, toPublic(ana), t!.id, later, "Cliente pediu para quinta");
    const notes = await db.select().from(companyNotes).where(eq(companyNotes.companyId, coId));
    expect(notes.some((n) => n.text.includes("reagendada") && n.text.includes("Cliente pediu para quinta"))).toBe(true);
    const c = await callFromTask(db, toPublic(ana), t!.id);
    expect(c.phone?.value).toBe(`91${tag}1`);
    expect((await db.query.calls.findFirst({ where: eq(calls.id, c.callId) }))!.source).toBe("agenda");
    await expect(closeTask(db, toPublic(ana), t!.id, "cancelled")).rejects.toThrow(/porque/);
    await expect(closeTask(db, toPublic(ana), t!.id, "done")).rejects.toThrow(/feedback/);
    await closeTask(db, toPublic(ana), t!.id, "done", "Falei com o Rui, envia proposta amanhã");
    expect((await db.select().from(companyNotes).where(eq(companyNotes.companyId, coId))).map((n) => n.text)).toContain("Tarefa terminada: Falei com o Rui, envia proposta amanhã");
    const d = await myDay(db, toPublic(ana));
    expect(d).toMatchObject({ calls: 0, sales: 0, late: 0 });
    expect(d.breakLimit).toBeGreaterThan(0);
    expect((await listAgenda(db, toPublic(ana))).length).toBe(0);
  });
});
