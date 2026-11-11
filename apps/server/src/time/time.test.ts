import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { companies, timeEntries, users } from "../db/schema.js";
import { toPublic } from "../auth/service.js";
import { startCall } from "../dialer/service.js";
import { closeStale, daySummary, heartbeat, setState } from "./service.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("estados e registo de ponto", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const tag = String(Date.now()).slice(-6);
  type U = typeof users.$inferSelect;
  let admin: U, ana: U, bia: U;

  beforeAll(async () => {
    const mk = (n: string, role: "admin" | "sales") => db.insert(users).values({ name: `${n} ${tag}`, email: `${n}-t${tag}@basecom.pt`, role, passwordHash: "x", mustChangePassword: false }).returning().then((r) => r[0]!);
    admin = await mk("adm", "admin"); ana = await mk("ana", "sales"); bia = await mk("bia", "sales");
  });
  afterAll(async () => {
    await db.delete(timeEntries).where(inArray(timeEntries.userId, [ana.id, bia.id]));
    await db.execute(sql`delete from audit_log where user_id = ${admin.id}`);
    await db.delete(users).where(inArray(users.id, [admin.id, ana.id, bia.id]));
    await pool.end();
  });

  it("o primeiro sinal do dia é a entrada; os estados somam por tipo", async () => {
    expect(await heartbeat(db, toPublic(ana))).toBe("working");
    // Simula 10 minutos a trabalhar e 6 de intervalo.
    await db.update(timeEntries).set({ startedAt: sql`now() - interval '16 minutes'` }).where(eq(timeEntries.userId, ana.id));
    await setState(db, toPublic(ana), ana.id, "break");
    await db.execute(sql`update time_entries set ended_at = now() - interval '6 minutes', last_seen_at = now() - interval '6 minutes' where user_id = ${ana.id} and state = 'working'`);
    await db.execute(sql`update time_entries set started_at = now() - interval '6 minutes' where user_id = ${ana.id} and state = 'break'`);
    const s = await daySummary(db, ana.id);
    expect(s.state).toBe("break");
    expect(Math.round(s.seconds.working / 60)).toBe(10);
    expect(Math.round(s.seconds.break / 60)).toBe(6);
    expect(s.over.break).toBe(false);
    expect(s.entrada).not.toBeNull();
  });

  it("em intervalo não se marcam chamadas de campanha", async () => {
    const [co] = await db.insert(companies).values({ nif: `5${tag}99`, name: `T ${tag}`, nameKey: `t ${tag}`, accountType: "prospect" }).returning();
    await expect(startCall(db, toPublic(ana), { companyId: co!.id, entryId: "00000000-0000-0000-0000-000000000000", source: "new" })).rejects.toThrow(/intervalo/);
    await db.delete(companies).where(eq(companies.id, co!.id));
  });

  it("só o Administrador (ou Chefe de Equipa) põe outra pessoa em formação, e essa não conta para os 5 min próprios", async () => {
    await expect(setState(db, toPublic(bia), ana.id, "training")).rejects.toThrow();
    await setState(db, toPublic(admin), ana.id, "training");
    await db.execute(sql`update time_entries set started_at = now() - interval '20 minutes' where user_id = ${ana.id} and state = 'training'`);
    const s = await daySummary(db, ana.id);
    expect(s.state).toBe("training");
    expect(s.used.ownTraining).toBe(0);
    expect(s.over.training).toBe(false);
  });

  it("sem sinal de vida há mais de 3 min, o período fecha no último sinal; sair fecha o dia", async () => {
    await heartbeat(db, toPublic(bia));
    await db.execute(sql`update time_entries set last_seen_at = now() - interval '10 minutes' where user_id = ${bia.id}`);
    await closeStale(db);
    expect((await db.select().from(timeEntries).where(eq(timeEntries.userId, bia.id)))[0]!.endedAt).not.toBeNull();
    await heartbeat(db, toPublic(bia)); // volta: novo período
    await setState(db, toPublic(bia), bia.id, "off");
    const s = await daySummary(db, bia.id);
    expect(s.state).toBeNull();
    expect(s.saida).not.toBeNull();
  });
});
