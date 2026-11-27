import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { normalizePhone } from "@basecom/shared";
import type { Db } from "../db/client.js";
import { auditLog, calls, companyContacts, companyNotes, devices, incomingCalls, pairingCodes, phoneCommands, users } from "../db/schema.js";
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

/** SMS (17 nov): o telemóvel BASECOM abre a app de mensagens com o número e o texto; o comercial envia no telemóvel. */
export async function queueSms(db: Db, userId: string, number: string, text: string, companyId?: string) {
  const d = await myDevice(db, userId);
  if (!d?.online) return false;
  await db.insert(phoneCommands).values({ deviceId: d.id, number, kind: "sms", text, companyId: companyId ?? null });
  return true;
}

/** «Desligar» no CRM: se a chamada foi marcada pelo telemóvel, pede-lhe que a desligue. */
export async function queueHangup(db: Db, userId: string, callId: string) {
  const sent = await db.query.phoneCommands.findFirst({ where: and(eq(phoneCommands.callId, callId), eq(phoneCommands.kind, "dial")) });
  if (!sent) {
    // Chamada recebida (atendida no telemóvel): desliga a chamada em curso nesse telemóvel.
    const c = await db.query.calls.findFirst({ where: eq(calls.id, callId) });
    const d = c?.source === "recebida" ? await myDevice(db, userId) : null;
    if (!d?.online) return false;
    await db.insert(phoneCommands).values({ deviceId: d.id, callId, number: "", kind: "hangup" });
    return true;
  }
  if (sent.status === "expired") return false;
  await db.update(phoneCommands).set({ status: "expired" }).where(and(eq(phoneCommands.callId, callId), eq(phoneCommands.status, "pending")));
  await db.insert(phoneCommands).values({ deviceId: sent.deviceId, callId, number: "", kind: "hangup" });
  return true;
}

/** O telemóvel pergunta «há alguma chamada para fazer?» e espera até 25 s pela resposta (long polling). */
export async function nextCommand(db: Db, deviceId: string, waitMs = 25_000) {
  const until = Date.now() + waitMs;
  for (;;) {
    await db.update(phoneCommands).set({ status: "expired" }).where(and(eq(phoneCommands.deviceId, deviceId), eq(phoneCommands.status, "pending"), lt(phoneCommands.createdAt, new Date(Date.now() - COMMAND_TTL_MS))));
    const r = await db.execute(sql`update phone_commands set status = 'sent', sent_at = now()
      where id = (select id from phone_commands where device_id = ${deviceId}::uuid and status = 'pending' order by created_at limit 1 for update skip locked)
      returning id, number, kind, text, call_id as "callId"`);
    const c = r.rows[0] as { id: string; number: string; kind: string; text: string | null; callId: string | null } | undefined;
    if (c) return { id: c.id, kind: c.kind, number: c.number ? `+351${c.number}` : "", text: c.text, callId: c.callId };
    if (Date.now() >= until) return null;
    await new Promise((res) => setTimeout(res, 1000));
  }
}

export type DeviceEvent =
  | { type: "outgoing_ended"; callId: string; endedAt: string; durationSeconds: number }
  | { type: "incoming_ringing"; number: string; at: string }
  | { type: "incoming_answered"; incomingId: string; at: string }
  /** Chamada que entrou durante outra chamada e não foi atendida (lida do registo do telemóvel no fim da chamada). */
  | { type: "incoming_missed"; number: string; at: string }
  | { type: "incoming_ended"; incomingId: string; endedAt: string; durationSeconds: number }
  /** 20 nov: a app enviou a SMS sozinha (ou falhou, ou abriu a mensagem por falta de autorização). */
  | { type: "sms_result"; commandId: string; result: "sent" | "failed" | "opened"; error?: string };

/** Empresas com este número (pode haver mais de uma). */
async function companiesFor(db: Db, national: string) {
  const r = await db.execute(sql`select distinct c.id, c.name, c.nif from company_contacts k join companies c on c.id = k.company_id
    where k.kind = 'phone' and k.value = ${national} order by c.name limit 10`);
  return r.rows as { id: string; name: string; nif: string }[];
}

export async function deviceEvent(db: Db, device: { id: string; userId: string }, ev: DeviceEvent) {
  if (ev.type === "outgoing_ended") {
    const c = await db.query.calls.findFirst({ where: eq(calls.id, ev.callId) });
    if (!c || c.userId !== device.userId) throw new AuthError(404, "Chamada não encontrada.");
    // O fim informado pelo telemóvel conta para os 15 s de registo (se o comercial ainda não carregou em «Desligar»).
    await db.update(calls).set({ endedAt: c.endedAt ?? new Date(ev.endedAt), durationSeconds: ev.durationSeconds, answered: ev.durationSeconds > 0, via: "app" }).where(eq(calls.id, c.id));
    await db.update(phoneCommands).set({ status: "done" }).where(eq(phoneCommands.callId, c.id));
    return { ok: true };
  }
  if (ev.type === "incoming_ringing" || ev.type === "incoming_missed") {
    const p = normalizePhone(ev.number);
    // 24 nov: só liga a chamada a uma empresa quando o número é de uma só; com várias, o ecrã mostra todas.
    const owners = p ? [...new Set((await db.select({ id: companyContacts.companyId }).from(companyContacts).where(and(eq(companyContacts.kind, "phone"), eq(companyContacts.value, p.national)))).map((x) => x.id))] : [];
    const company = owners.length === 1 ? { id: owners[0]! } : undefined;
    const number = p?.national ?? ev.number.slice(0, 30);
    const at = new Date(ev.at);
    if (ev.type === "incoming_missed") {
      // Sem duplicados: o mesmo número à mesma hora já registado.
      const dup = await db.execute(sql`select 1 from incoming_calls where user_id = ${device.userId}::uuid and number = ${number} and abs(extract(epoch from ringing_at - ${at.toISOString()}::timestamptz)) < 90`);
      if (dup.rows.length) return { ok: true };
      await db.insert(incomingCalls).values({ userId: device.userId, number, companyId: company?.id ?? null, ringingAt: at, endedAt: at, answered: false, durationSeconds: 0 });
      return { ok: true };
    }
    const [row] = await db.insert(incomingCalls).values({ userId: device.userId, number, companyId: company?.id ?? null, ringingAt: at }).returning({ id: incomingCalls.id });
    return { incomingId: row!.id };
  }
  if (ev.type === "sms_result") {
    const c = await db.query.phoneCommands.findFirst({ where: eq(phoneCommands.id, ev.commandId) });
    if (!c || c.deviceId !== device.id) throw new AuthError(404, "Pedido de SMS não encontrado.");
    await db.update(phoneCommands).set({ status: "done" }).where(eq(phoneCommands.id, c.id));
    if (c.companyId) {
      const text = ev.result === "sent" ? `SMS enviada pelo telemóvel BASECOM para ${c.number}` : ev.result === "failed" ? `SMS não enviada para ${c.number}${ev.error ? ` (${ev.error.slice(0, 120)})` : ""}` : `SMS aberta no telemóvel para ${c.number} (sem autorização para enviar sozinha)`;
      await db.insert(companyNotes).values({ companyId: c.companyId, kind: "message", userId: device.userId, text });
    }
    return { ok: true };
  }
  if (ev.type === "incoming_answered") {
    const ic = await db.query.incomingCalls.findFirst({ where: eq(incomingCalls.id, ev.incomingId) });
    if (!ic || ic.userId !== device.userId) throw new AuthError(404, "Chamada recebida não encontrada.");
    await db.update(incomingCalls).set({ answeredAt: new Date(ev.at), answered: true }).where(eq(incomingCalls.id, ic.id));
    return { ok: true };
  }
  const ic = await db.query.incomingCalls.findFirst({ where: eq(incomingCalls.id, ev.incomingId) });
  if (!ic || ic.userId !== device.userId) throw new AuthError(404, "Chamada recebida não encontrada.");
  await db.update(incomingCalls).set({ endedAt: new Date(ev.endedAt), durationSeconds: ev.durationSeconds, answered: ev.durationSeconds > 0 || !!ic.answeredAt }).where(eq(incomingCalls.id, ic.id));
  // Resultado aberto no CRM para esta chamada recebida: o fim conta para os 15 s.
  await db.execute(sql`update calls set ended_at = ${new Date(ev.endedAt).toISOString()}::timestamptz, duration_seconds = ${ev.durationSeconds}, answered = ${ev.durationSeconds > 0 || !!ic.answeredAt}, via = 'app'
    where user_id = ${device.userId}::uuid and source = 'recebida' and ended_at is null and phone = ${ic.number} and started_at > ${ic.ringingAt.toISOString()}::timestamptz`);
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
  const r = await db.execute(sql`select i.id, i.number, i.ringing_at as "ringingAt", i.answered_at as "answeredAt", i.ended_at as "endedAt", i.company_id as "companyId", c.name as company, c.nif,
      o.name as owner, (select count(*)::int from tasks t where t.company_id = i.company_id and t.status = 'open') as "openTasks"
    from incoming_calls i left join companies c on c.id = i.company_id left join users o on o.id = c.owner_id
    where i.user_id = ${user.id}::uuid and i.ended_at is null and i.ringing_at > now() - interval '2 hours'
      and (i.answered_at is not null or i.ringing_at > now() - interval '2 minutes') order by i.ringing_at desc limit 1`);
  const row = (r.rows[0] ?? null) as { id: string; number: string; ringingAt: string; answeredAt: string | null; endedAt: string | null; companyId: string | null; company: string | null; nif: string | null; owner: string | null; openTasks: number } | null;
  return row ? { ...row, companies: /^\d{9}$/.test(row.number) ? await companiesFor(db, row.number) : [] } : null;
}

/** Ecrã «Chamadas recebidas» (17 nov): últimos dias, com as empresas desse número e se já foi devolvida. */
export async function receivedList(db: Db, user: PublicUser, days = 7) {
  const r = await db.execute(sql`select i.id, i.number, i.ringing_at as "ringingAt", i.answered, i.duration_seconds as "durationSeconds", i.ended_at as "endedAt",
      exists (select 1 from calls k where k.user_id = i.user_id and k.phone = i.number and k.started_at > i.ringing_at) as returned
    from incoming_calls i where i.user_id = ${user.id}::uuid and i.ringing_at > now() - make_interval(days => ${days}::int)
    order by i.ringing_at desc limit 300`);
  const rows = r.rows as { id: string; number: string; ringingAt: string; answered: boolean | null; durationSeconds: number | null; endedAt: string | null; returned: boolean }[];
  const cache = new Map<string, { id: string; name: string; nif: string }[]>();
  const out = [];
  for (const x of rows) {
    if (/^\d{9}$/.test(x.number) && !cache.has(x.number)) cache.set(x.number, await companiesFor(db, x.number));
    out.push({ ...x, missed: !x.answered && !!x.endedAt, companies: cache.get(x.number) ?? [] });
  }
  return out;
}

/** Número no menu «Ligar»: não atendidas dos últimos 3 dias que ainda não foram devolvidas. */
export async function missedCount(db: Db, userId: string) {
  const r = await db.execute(sql`select count(*)::int as n from incoming_calls i where i.user_id = ${userId}::uuid
    and not coalesce(i.answered, false) and i.ended_at is not null and i.ringing_at > now() - interval '3 days'
    and not exists (select 1 from calls k where k.user_id = i.user_id and k.phone = i.number and k.started_at > i.ringing_at)`);
  return (r.rows[0] as { n: number }).n;
}

/** Mute no telemóvel BASECOM (desenho 13). */
export async function queueMute(db: Db, userId: string, on: boolean) {
  const d = await myDevice(db, userId);
  if (!d?.online) throw new AuthError(409, "O telemóvel BASECOM não está ligado.");
  await db.insert(phoneCommands).values({ deviceId: d.id, number: "", kind: "mute", text: on ? "1" : "0" });
  return { ok: true, on };
}

/** 27 nov: «Atender» no CRM — o telemóvel BASECOM atende a chamada que está a tocar. */
export async function queueAnswer(db: Db, userId: string) {
  const d = await myDevice(db, userId);
  if (!d?.online) throw new AuthError(409, "O telemóvel BASECOM não está ligado. Atenda no telemóvel.");
  await db.insert(phoneCommands).values({ deviceId: d.id, number: "", kind: "answer" });
  return { ok: true };
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
