import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { companies, notifications, tasks, teams, users } from "../db/schema.js";
import { toPublic } from "../auth/service.js";
import { listAgenda } from "../agenda/service.js";
import { teamToday } from "../time/service.js";
import { notifyLeadOrAdmin } from "../notifications/service.js";
import { saveTeam, visibleUserIds } from "./service.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("equipas e visibilidade", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const tag = String(Date.now()).slice(-6);
  type U = typeof users.$inferSelect;
  let admin: U, chefe: U, ana: U, bia: U, coId = "";
  const teamIds: string[] = [];
  beforeAll(async () => {
    const mk = (n: string, role: "admin" | "sales" | "team_lead") => db.insert(users).values({ name: `${n} ${tag}`, email: `${n}-e${tag}@basecom.pt`, role, passwordHash: "x", mustChangePassword: false }).returning().then((r) => r[0]!);
    admin = await mk("adm", "admin"); chefe = await mk("chefe", "team_lead"); ana = await mk("ana", "sales"); bia = await mk("bia", "sales");
    const [c] = await db.insert(companies).values({ nif: `2${tag}44`, name: `Eq ${tag}`, nameKey: `eq ${tag}`, accountType: "prospect" }).returning();
    coId = c!.id;
    await db.insert(tasks).values([{ companyId: coId, type: "Ligar", assignedTo: ana.id, dueAt: new Date(), origin: "manual" }, { companyId: coId, type: "Ligar", assignedTo: bia.id, dueAt: new Date(), origin: "manual" }]);
  });
  afterAll(async () => {
    await db.delete(teams).where(inArray(teams.id, teamIds));
    await db.delete(companies).where(eq(companies.id, coId));
    await db.execute(sql`delete from audit_log where user_id in ${[admin.id, chefe.id]}`);
    await db.delete(users).where(inArray(users.id, [admin.id, chefe.id, ana.id, bia.id]));
    await pool.end();
  });

  it("o Chefe de Equipa vê a sua equipa; o comercial só o seu; o Administrador todos", async () => {
    await expect(saveTeam(db, toPublic(admin), { name: "Norte", leadId: ana.id, memberIds: [] })).rejects.toThrow(/Chefe de Equipa/);
    const t = await saveTeam(db, toPublic(admin), { name: `Norte ${tag}`, leadId: chefe.id, memberIds: [ana.id] });
    teamIds.push(t.id);
    expect((await visibleUserIds(db, chefe))!.sort()).toEqual([chefe.id, ana.id].sort());
    expect(await visibleUserIds(db, ana)).toEqual([ana.id]);
    expect(await visibleUserIds(db, admin)).toBeNull();
    const ag = await listAgenda(db, toPublic(chefe));
    expect(ag.every((x) => x.assignedTo !== bia.id)).toBe(true);
    expect(ag.some((x) => x.assignedTo === ana.id)).toBe(true);
    await expect(listAgenda(db, toPublic(chefe), { userId: bia.id })).rejects.toThrow(/equipa/);
    expect((await teamToday(db, toPublic(chefe))).map((p) => p.id)).toEqual([ana.id]);
  });

  it("avisos de resultado fora do prazo vão para o Chefe de Equipa; sem equipa, para o Administrador", async () => {
    await notifyLeadOrAdmin(db, ana.id, { kind: "result_late", text: "teste ana" });
    await notifyLeadOrAdmin(db, bia.id, { kind: "result_late", text: "teste bia" });
    const toChefe = await db.select().from(notifications).where(eq(notifications.userId, chefe.id));
    expect(toChefe.map((n) => n.text)).toEqual(["teste ana"]);
    const toAdmin = await db.select().from(notifications).where(and(eq(notifications.userId, admin.id), eq(notifications.text, "teste bia")));
    expect(toAdmin.length).toBe(1);
  });
});
