import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { calls, companies, companyContacts, tasks, users } from "../db/schema.js";
import { toPublic } from "../auth/service.js";
import { callFromWallet, walletList } from "./service.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("C2C / Carteira", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const tag = String(Date.now()).slice(-6);
  type U = typeof users.$inferSelect;
  let admin: U, ana: U, bia: U;
  const ids: string[] = [];
  beforeAll(async () => {
    const mk = (n: string, role: "admin" | "sales") => db.insert(users).values({ name: `${n} ${tag}`, email: `${n}-c${tag}@basecom.pt`, role, passwordHash: "x", mustChangePassword: false }).returning().then((r) => r[0]!);
    admin = await mk("adm", "admin"); ana = await mk("ana", "sales"); bia = await mk("bia", "sales");
    for (const [i, owner] of [[1, ana], [2, ana], [3, bia]] as const) {
      const [c] = await db.insert(companies).values({ nif: `3${tag}3${i}`, name: `Cart ${tag} ${i}`, nameKey: `cart ${tag} ${i}`, accountType: "client", ownerId: owner.id, rgu: { VM: 3, IF: 1 } }).returning();
      ids.push(c!.id);
      await db.insert(companyContacts).values({ companyId: c!.id, kind: "phone", value: `92${tag}${i}`, isPrimary: true, personName: "Rui Sá", salutation: "Sr." });
    }
    await db.insert(tasks).values({ companyId: ids[0]!, type: "Ligar", assignedTo: ana.id, dueAt: new Date(Date.now() - 3600_000), origin: "manual" });
  });
  afterAll(async () => {
    await db.delete(calls).where(inArray(calls.companyId, ids));
    await db.delete(companies).where(inArray(companies.id, ids));
    await db.execute(sql`delete from time_entries where user_id in ${[ana.id, bia.id]}`);
    await db.execute(sql`delete from audit_log where user_id in ${[admin.id, ana.id, bia.id]}`);
    await db.delete(users).where(inArray(users.id, [admin.id, ana.id, bia.id]));
    await pool.end();
  });

  it("cada comercial vê a sua carteira, com linhas, decisor, telefone e tarefas; o Administrador escolhe de quem", async () => {
    const a = await walletList(db, toPublic(ana));
    expect(a.map((x) => x.id).sort()).toEqual([ids[0], ids[1]].sort());
    expect(a.find((x) => x.id === ids[0])).toMatchObject({ lines: 4, decisor: "Sr. Rui Sá", phone: `92${tag}1`, openTasks: 1 });
    expect((await walletList(db, toPublic(ana), { tasks: "late" })).map((x) => x.id)).toEqual([ids[0]]);
    expect((await walletList(db, toPublic(admin), { ownerId: bia.id })).map((x) => x.id)).toEqual([ids[2]]);
  });

  it("só se liga a empresas da própria carteira", async () => {
    await expect(callFromWallet(db, toPublic(ana), ids[2]!)).rejects.toThrow(/não é da sua carteira/);
    const c = await callFromWallet(db, toPublic(ana), ids[0]!);
    expect((await db.query.calls.findFirst({ where: eq(calls.id, c.callId) }))!.source).toBe("wallet");
  });
});
