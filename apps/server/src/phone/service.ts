import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { normalizePhone } from "@basecom/shared";
import type { Db } from "../db/client.js";
import { auditLog, calls, companyContacts, devices, incomingCalls, pairingCodes, phoneCommands, users } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";
import { hashToken, newToken } from "../auth/crypto.js";

/**
 * Telefonia (Fase 4): a app BASECOM no Android liga-se ao CRM pela internet.
 * O CRM pede «liga para este número»; a app marca e devolve o fim da chamada, a duração e as chamadas recebidas.
 * Tudo passa por este adaptador: se o canal mudar (central na nuvem), os ecrãs não mudam.
 */

const ONLINE_SECONDS = 90;
const COMMAND_TTL_MS = 2 * 60_000;

export async function createPairingCode(db: Db, user: PublicUser) {
  await db.delete(pairingCodes).where(eq(pairingCodes.userId, user.id));
  for (let i = 0; i < 5; i++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const taken = await db.query.pairingCodes.findFirst({ where: and(eq(pairingCodes.code, code), gt(pairingCodes.expiresAt, new Date())) });
    if (taken) continue;
    await db.delete(pairingCodes).where(eq(pairingCodes.code, code));
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await db.insert(pairingCodes).values({ code, userId: user.id, expiresAt });
    return { code, expiresAt };
  }
  throw new AuthError(503, "Tente outra vez.");
}

/** O telemóvel troca o código por um token próprio. Um comercial tem um telemóvel: o anterior deixa de funcionar. */
export async function pairDevice(db: Db, code: string, model: string | undefined) {
  const pc = await db.query.pairingCodes.findFirst({ where: and(eq(pairingCodes.code, code), isNull(pairingCodes.usedAt), gt(pairingCodes.expiresAt, new Date())) });
  if (!pc) throw new AuthError(400, "Código inválido ou expirado. Gere um novo no CRM.");
  const { token, hash } = newToken();
  await db.transaction(async (tx) => {
    await tx.update(pairingCodes).set({ usedAt: new Date() }).where(eq(pairingCodes.code, code));
    await tx.update(devices).set({ revokedAt: new Date() }).where(and(eq(devices.userId, pc.userId), isNull(devices.revokedAt)));
    await tx.insert(devices).values({ userId: pc.userId, model: model?.slice(0, 80) ?? null, tokenHash: hash, lastSeenAt: new Date() });
    await tx.insert(auditLog).values({ userId: pc.userId, action: "telemovel_emparelhado", entity: "user", entityId: pc.userId, details: model ?? "" });
  });
  const u = (await db.query.users.findFirst({ where: eq(users.id, pc.userId) }))!;
  return { token, userName: u.name };
}

export async function deviceFromToken(db: Db, token: string | undefined) {
  if (!token) throw new AuthError(401, "Telemóvel não emparelhado.");
  const d = await db.query.devices.findFirst({ where: and(eq(devices.tokenHash, hashToken(token)), isNull(devices.revokedAt)) });
  if (!d) throw new AuthError(401, "Este telemóvel já não está emparelhado. Emparelhe de novo no CRM.");
  await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, d.id));
  return d;
}

export async function myDevice(db: Db, userId: string) {
  const d = (await db.select().from(devices).where(and(eq(devices.userId, userId), isNull(devices.revokedAt))).orderBy(desc(devices.pairedAt)).limit(1))[0];
  if (!d) return null;
  const online = !!d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < ONLINE_SECONDS * 1000;
  return { id: d.id, model: d.model, pairedAt: d.pairedAt, lastSeenAt: d.lastSeenAt, online };
}

export async function unpairDevice(db: Db, user: PublicUser) {
  await db.update(devices).set({ revokedAt: new Date() }).where(and(eq(devices.userId, user.id), isNull(devices.revokedAt)));
}

/** Se o comercial tem o telemóvel ligado, pede-lhe que marque o número. Devolve true quando o pedido seguiu. */
export async function queueDial(db: Db, userId: string, callId: string, number: string) {
  const d = await myDevice(db, userId);
  if (!d?.online) return false;
  await db.update(phoneCommands).set({ status: "expired" }).where(and(eq(phoneCommands.deviceId, d.id), eq(phoneCommands.status, "pending")));
  await db.insert(phoneCommands).values({ deviceId: d.id, callId, number });
  return true;
}

/** O telemóvel pergunta «há alguma chamada para fazer?» e espera até 25 s pela resposta (long polling). */
export async function nextCommand(db: Db, deviceId: string, waitMs = 25_000) {
  const until = Date.now() + waitMs;
  for (;;) {
    await db.update(phoneCommands).set({ status: "expired" }).where(and(eq(phoneCommands.deviceId, deviceId), eq(phoneCommands.status, "pending"), lt(phoneCommands.createdAt, new Date(Date.now() - COMMAND_TTL_MS))));
    const r = await db.execute(sql`update phone_commands set status = 'sent', sent_at = now()
      where id = (select id from phone_commands where device_id = ${deviceId}::uuid and status = 'pending' order by created_at limit 1 for update skip locked)
      returning id, number, call_id as "callId"`);
    const c = r.rows[0] as { id: string; number: string; callId: string | null } | undefined;
    if (c) return { id: c.id, number: `+351${c.number}`, callId: c.callId };
    if (Date.now() >= until) return null;
    await new Promise((res) => setTimeout(res, 1000));
  }
}

export type DeviceEvent =
  | { type: "outgoing_ended"; callId: string; endedAt: string; durationSeconds: number }
  | { type: "incoming_ringing"; number: string; at: string }
  | { type: "incoming_ended"; incomingId: string; endedAt: string; durationSeconds: number };

export async function deviceEvent(db: Db, device: { id: string; userId: string }, ev: DeviceEvent) {
  if (ev.type === "outgoing_ended") {
    const c = await db.query.calls.findFirst({ where: eq(calls.id, ev.callId) });
    if (!c || c.userId !== device.userId) throw new AuthError(404, "Chamada não encontrada.");
    // O fim informado pelo telemóvel conta para os 15 s de registo (se o comercial ainda não carregou em «Desligar»).
    await db.update(calls).set({ endedAt: c.endedAt ?? new Date(ev.endedAt), durationSeconds: ev.durationSeconds, answered: ev.durationSeconds > 0, via: "app" }).where(eq(calls.id, c.id));
    await db.update(phoneCommands).set({ status: "done" }).where(eq(phoneCommands.callId, c.id));
    return { ok: true };
  }
  if (ev.type === "incoming_ringing") {
    const p = normalizePhone(ev.number);
    const company = p ? (await db.select({ id: companyContacts.companyId }).from(companyContacts).where(and(eq(companyContacts.kind, "phone"), eq(companyContacts.value, p.national))).limit(1))[0] : undefined;
    const [row] = await db.insert(incomingCalls).values({ userId: device.userId, number: p?.national ?? ev.number.slice(0, 30), companyId: company?.id ?? null, ringingAt: new Date(ev.at) }).returning({ id: incomingCalls.id });
    return { incomingId: row!.id };
  }
  const ic = await db.query.incomingCalls.findFirst({ where: eq(incomingCalls.id, ev.incomingId) });
  if (!ic || ic.userId !== device.userId) throw new AuthError(404, "Chamada recebida não encontrada.");
  await db.update(incomingCalls).set({ endedAt: new Date(ev.endedAt), durationSeconds: ev.durationSeconds, answered: ev.durationSeconds > 0 }).where(eq(incomingCalls.id, ic.id));
  return { ok: true };
}

/** Para o ecrã Ligar: a chamada já acabou no telemóvel? */
export async function callStatus(db: Db, user: PublicUser, callId: string) {
  const c = await db.query.calls.findFirst({ where: eq(calls.id, callId) });
  if (!c || c.userId !== user.id) throw new AuthError(404, "Chamada não encontrada.");
  return { endedAt: c.endedAt, durationSeconds: c.durationSeconds, answered: c.answered, via: c.via };
}

/** Aviso «Chamada a entrar»: a última chamada recebida nos últimos 2 minutos, com a empresa se o número for conhecido. */
export async function latestIncoming(db: Db, user: PublicUser) {
  const r = await db.execute(sql`select i.id, i.number, i.ringing_at as "ringingAt", i.ended_at as "endedAt", i.company_id as "companyId", c.name as company,
      o.name as owner, (select count(*)::int from tasks t where t.company_id = i.company_id and t.status = 'open') as "openTasks"
    from incoming_calls i left join companies c on c.id = i.company_id left join users o on o.id = c.owner_id
    where i.user_id = ${user.id}::uuid and i.ringing_at > now() - interval '2 minutes' order by i.ringing_at desc limit 1`);
  return (r.rows[0] ?? null) as { id: string; number: string; ringingAt: string; endedAt: string | null; companyId: string | null; company: string | null; owner: string | null; openTasks: number } | null;
}

export async function receivedToday(db: Db, userId: string) {
  const r = await db.execute(sql`select count(*)::int as n from incoming_calls where user_id = ${userId}::uuid
    and (ringing_at at time zone 'Europe/Lisbon')::date = (now() at time zone 'Europe/Lisbon')::date`);
  return (r.rows[0] as { n: number }).n;
}

/**
 * Chamadas recebidas de hoje (T7): recebidas, atendidas, por retribuir e retribuídas.
 * Uma recebida não atendida conta como retribuída se o comercial ligar para esse número depois (até ao fim do dia útil seguinte).
 */
export async function incomingStats(db: Db, userId: string) {
  const r = await db.execute(sql`with i as (
      select i.*, exists (select 1 from calls k where k.user_id = i.user_id and k.phone = i.number and k.started_at > i.ringing_at
        and k.started_at < i.ringing_at + interval '3 days') as returned
      from incoming_calls i where i.user_id = ${userId}::uuid
        and (i.ringing_at at time zone 'Europe/Lisbon')::date = (now() at time zone 'Europe/Lisbon')::date)
    select count(*)::int as received, count(*) filter (where answered)::int as answered,
      count(*) filter (where not coalesce(answered, false) and returned)::int as returned,
      count(*) filter (where not coalesce(answered, false) and not returned and ended_at is not null)::int as "toReturn"
    from i`);
  return r.rows[0] as { received: number; answered: number; returned: number; toReturn: number };
}
