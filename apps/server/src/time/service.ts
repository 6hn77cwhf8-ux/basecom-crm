import { and, inArray, asc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { lisbonDay, pontoDay } from "@basecom/shared";
import type { Db } from "../db/client.js";
import { auditLog, timeEntries, users } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";
import { getSetting } from "../settings.js";
import { notify } from "../notifications/service.js";
import { canSee, visibleUserIds } from "../teams/service.js";
import { incomingStats } from "../phone/service.js";

/**
 * Estados do comercial e registo de ponto (catálogo, secção 14).
 * A aplicação envia um sinal de vida a cada minuto; se fechar sem sair, o período termina no último sinal.
 */
export type State = "working" | "training" | "break" | "switch";
export const STATE_LABEL: Record<State, string> = { working: "A trabalhar", training: "Formação", break: "Intervalo", switch: "Mudança de campanha" };
const STALE_MS = 3 * 60_000;

async function openEntry(db: Db, userId: string) {
  return (await db.select().from(timeEntries).where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endedAt))).orderBy(asc(timeEntries.startedAt)))[0];
}

/** Fecha períodos abertos sem sinal de vida há mais de 3 minutos (aplicação fechada ou sem rede). */
export async function closeStale(db: Db, now = new Date()) {
  await db.update(timeEntries).set({ endedAt: sql`${timeEntries.lastSeenAt}` })
    .where(and(isNull(timeEntries.endedAt), lt(timeEntries.lastSeenAt, new Date(now.getTime() - STALE_MS))));
}

/** Estado atual (fecha o anterior e abre o novo). Outra pessoa só pode pôr alguém em formação. */
export async function setState(db: Db, actor: PublicUser, userId: string, state: State | "off") {
  if (actor.id !== userId) {
    if (actor.role === "sales") throw new AuthError(403, "Só o Chefe de Equipa ou o Administrador podem mudar o estado de outra pessoa.");
    if (state !== "training") throw new AuthError(400, "Pode apenas colocar outra pessoa em formação.");
    if (!(await canSee(db, actor, userId))) throw new AuthError(403, "Esta pessoa não é da sua equipa.");
  }
  await closeStale(db);
  const now = new Date();
  const cur = await openEntry(db, userId);
  if (cur && cur.state === state) { await db.update(timeEntries).set({ lastSeenAt: now }).where(eq(timeEntries.id, cur.id)); return; }
  await db.transaction(async (tx) => {
    if (cur) await tx.update(timeEntries).set({ endedAt: now, lastSeenAt: now }).where(eq(timeEntries.id, cur.id));
    if (state !== "off") await tx.insert(timeEntries).values({ userId, state, startedAt: now, lastSeenAt: now, setBy: actor.id === userId ? null : actor.id });
    if (actor.id !== userId) await tx.insert(auditLog).values({ userId: actor.id, action: "estado_alterado", entity: "user", entityId: userId, details: STATE_LABEL[state as State] });
  });
}

/** Sinal de vida: mantém o período aberto; a primeira vez no dia é a entrada (A trabalhar). */
export async function heartbeat(db: Db, user: PublicUser) {
  await closeStale(db);
  const cur = await openEntry(db, user.id);
  if (cur) {
    await db.update(timeEntries).set({ lastSeenAt: new Date() }).where(eq(timeEntries.id, cur.id));
    // Intervalo acima do limite do dia: avisa o Administrador uma vez por dia.
    if (cur.state === "break") {
      const d = await daySummary(db, user.id);
      if (d.over.break) await notify(db, ["admin"], { kind: "break_over", aboutUserId: user.id, dedupeKey: `break_over:${d.day}:${user.id}`, text: `${user.name} passou o limite de intervalo de hoje (${Math.round(d.used.break / 60)} de ${d.limits.breakSeconds / 60} min).` });
    }
    return cur.state as State;
  }
  await setState(db, user, user.id, "working");
  return "working" as State;
}

export async function currentState(db: Db, userId: string) {
  await closeStale(db);
  return ((await openEntry(db, userId))?.state ?? null) as State | null;
}

/** Resumo do dia (Lisboa): entrada, saída, tempo por estado, limites e o que resta. */
export async function daySummary(db: Db, userId: string, now = new Date()) {
  await closeStale(db, now);
  const day = lisbonDay(now);
  const from = new Date(now.getTime() - 36 * 3600_000);
  const rows = await db.select().from(timeEntries).where(and(eq(timeEntries.userId, userId), or(gte(timeEntries.startedAt, from), isNull(timeEntries.endedAt)))).orderBy(asc(timeEntries.startedAt));
  const today = rows.filter((r) => lisbonDay(r.startedAt) === day);
  const secs: Record<State, number> = { working: 0, training: 0, break: 0, switch: 0 };
  let ownTraining = 0;
  for (const r of today) {
    const end = r.endedAt ?? now;
    const s = Math.max(0, Math.round((end.getTime() - r.startedAt.getTime()) / 1000));
    secs[r.state as State] += s;
    if (r.state === "training" && !r.setBy) ownTraining += s;
  }
  const lim = await getSetting(db, "timeLimits");
  const open = today.find((r) => !r.endedAt);
  return {
    day, state: (open?.state ?? null) as State | null,
    entrada: today[0]?.startedAt ?? null, saida: open ? null : today.at(-1)?.endedAt ?? null,
    seconds: secs, total: secs.working + secs.training + secs.break + secs.switch,
    limits: { breakSeconds: lim.breakMinutes * 60, trainingSeconds: lim.trainingMinutes * 60, switchSeconds: lim.campaignSwitchMinutes * 60 },
    used: { break: secs.break, ownTraining, switch: secs.switch },
    over: { break: secs.break > lim.breakMinutes * 60, training: ownTraining > lim.trainingMinutes * 60, switch: secs.switch > lim.campaignSwitchMinutes * 60 },
    periods: today.map((r) => ({ state: r.state, from: r.startedAt, to: r.endedAt, byOther: !!r.setBy })),
    ponto: pontoDay(today.map((r) => ({ from: r.startedAt, to: r.endedAt })), now, expectedMinutes(day, lim) * 60),
  };
}

/** Quem vê o quê: o comercial vê os seus; o Administrador vê toda a estrutura (o Chefe de Equipa, a sua equipa, quando houver equipas). */
export async function teamToday(db: Db, actor: PublicUser) {
  if (actor.role === "sales") throw new AuthError(403, "Só o Chefe de Equipa (a sua equipa) e o Administrador veem os tempos de outras pessoas.");
  const v = await visibleUserIds(db, actor);
  const people = await db.select({ id: users.id, name: users.name, role: users.role }).from(users)
    .where(and(eq(users.active, true), sql`${users.role} <> 'admin'`, v === null ? sql`true` : inArray(users.id, v.filter((x) => x !== actor.id)))).orderBy(users.name);
  return Promise.all(people.map(async (p) => ({ ...p, ...(await daySummary(db, p.id)), incoming: await incomingStats(db, p.id) })));
}

/** Horas previstas do dia (Lisboa): dias úteis e sábado configuráveis; domingo 0. */
function expectedMinutes(day: string, lim: { dailyMinutes?: number; saturdayMinutes?: number }) {
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  return wd === 0 ? 0 : wd === 6 ? lim.saturdayMinutes ?? 255 : lim.dailyMinutes ?? 480;
}

/** Exportar o ponto: uma linha por pessoa e por dia (entrada, almoço, saída, presença, saldo, intervalo, formação). */
export async function pontoRows(db: Db, actor: PublicUser, from: string, to: string) {
  if (actor.role === "sales") throw new AuthError(403, "Só o Chefe de Equipa (a sua equipa) e o Administrador exportam o ponto.");
  const v = await visibleUserIds(db, actor);
  const people = await db.select({ id: users.id, name: users.name }).from(users).where(and(sql`${users.role} <> 'admin'`, v === null ? sql`true` : inArray(users.id, v))).orderBy(users.name);
  const rows: { day: string; name: string; d: Awaited<ReturnType<typeof daySummary>> }[] = [];
  for (let t = new Date(`${from}T12:00:00Z`); lisbonDay(t) <= to; t = new Date(t.getTime() + 86_400_000)) {
    const day = lisbonDay(t);
    const endOfDay = new Date(`${day}T23:59:00Z`);
    const at = endOfDay > new Date() ? new Date() : endOfDay;
    for (const p of people) {
      const d = await daySummary(db, p.id, at);
      if (d.periods.length) rows.push({ day, name: p.name, d });
    }
  }
  return rows;
}
