import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { calls, companies, companyContacts, users } from "../db/schema.js";
import { toPublic } from "../auth/service.js";
import { endCall, startCall } from "../dialer/service.js";
import { incomingStats, callStatus, createPairingCode, deviceEvent, deviceFromToken, latestIncoming, myDevice, nextCommand, pairDevice, receivedToday } from "./service.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("telefonia: app Android", () => {
  const { db, pool } = createDb(url ?? "postgres://x@localhost/x");
  const tag = String(Date.now()).slice(-6);
  let ana: typeof users.$inferSelect, coId = "", phoneId = "";
  beforeAll(async () => {
    [ana] = await db.insert(users).values({ name: `ana ${tag}`, email: `ana-p${tag}@basecom.pt`, role: "sales", passwordHash: "x", mustChangePassword: false }).returning() as [typeof users.$inferSelect];
    const [c] = await db.insert(companies).values({ nif: `1${tag}55`, name: `Tel ${tag}`, nameKey: `tel ${tag}`, accountType: "prospect" }).returning();
    coId = c!.id;
    [{ id: phoneId }] = await db.insert(companyContacts).values({ companyId: coId, kind: "phone", value: `96${tag}1`, isPrimary: true }).returning() as [{ id: string }];
  });
  afterAll(async () => {
    await db.delete(calls).where(eq(calls.companyId, coId));
    await db.delete(companies).where(eq(companies.id, coId));
    await db.execute(sql`delete from audit_log where user_id = ${ana.id}`);
    await db.delete(users).where(inArray(users.id, [ana.id]));
    await pool.end();
  });

  it("emparelhar com código de 6 algarismos (uma vez); o novo telemóvel substitui o anterior", async () => {
    const { code } = await createPairingCode(db, toPublic(ana));
    expect(code).toMatch(/^\d{6}$/);
    const p = await pairDevice(db, code, "TCL 505");
    expect(p.userName).toBe(`ana ${tag}`);
    await expect(pairDevice(db, code, "outro")).rejects.toThrow(/inválido/);
    expect((await myDevice(db, ana.id))!.online).toBe(true);
    const second = await pairDevice(db, (await createPairingCode(db, toPublic(ana))).code, "OPPO");
    await expect(deviceFromToken(db, p.token)).rejects.toThrow(/já não está emparelhado/);
    (globalThis as Record<string, unknown>).tok = second.token;
  });

  it("o CRM pede a marcação; o telemóvel recebe o número e devolve o fim e a duração", async () => {
    const d = await deviceFromToken(db, (globalThis as Record<string, unknown>).tok as string);
    const c = await startCall(db, toPublic(ana), { companyId: coId, contactId: phoneId, source: "ficha" });
    expect(c.viaPhone).toBe(true);
    const cmd = await nextCommand(db, d.id, 0);
    expect(cmd).toMatchObject({ number: `+35196${tag}1`, callId: c.id });
    expect(await nextCommand(db, d.id, 0)).toBeNull();
    // «Desligar» no CRM: o telemóvel recebe o pedido de desligar.
    await endCall(db, toPublic(ana), c.id);
    expect(await nextCommand(db, d.id, 0)).toMatchObject({ kind: "hangup", callId: c.id });
    await deviceEvent(db, d, { type: "outgoing_ended", callId: c.id, endedAt: new Date().toISOString(), durationSeconds: 42 });
    expect(await callStatus(db, toPublic(ana), c.id)).toMatchObject({ durationSeconds: 42, answered: true, via: "app" });
  });

  it("chamada recebida de um cliente conhecido: aviso com a empresa e conta como recebida", async () => {
    const d = await deviceFromToken(db, (globalThis as Record<string, unknown>).tok as string);
    const before = await receivedToday(db, ana.id);
    const r = await deviceEvent(db, d, { type: "incoming_ringing", number: `+351 96${tag}1`, at: new Date().toISOString() }) as { incomingId: string };
    expect((await latestIncoming(db, toPublic(ana)))).toMatchObject({ companyId: coId, company: `Tel ${tag}` });
    await deviceEvent(db, d, { type: "incoming_ended", incomingId: r.incomingId, endedAt: new Date().toISOString(), durationSeconds: 0 });
    expect(await receivedToday(db, ana.id)).toBe(before + 1);
  });

  it("recebidas não atendidas ficam «por retribuir» até o comercial ligar para esse número", async () => {
    const d = await deviceFromToken(db, (globalThis as Record<string, unknown>).tok as string);
    const before = await incomingStats(db, ana.id);
    const r = await deviceEvent(db, d, { type: "incoming_ringing", number: "+351 911 222 333", at: new Date().toISOString() }) as { incomingId: string };
    await deviceEvent(db, d, { type: "incoming_ended", incomingId: r.incomingId, endedAt: new Date().toISOString(), durationSeconds: 0 });
    expect((await incomingStats(db, ana.id)).toReturn).toBe(before.toReturn + 1);
    await db.insert(calls).values({ companyId: coId, userId: ana.id, phone: "911222333", source: "ficha", startedAt: new Date(Date.now() + 1000) });
    const after = await incomingStats(db, ana.id);
    expect(after).toMatchObject({ toReturn: before.toReturn, returned: before.returned + 1 });
  });
});
