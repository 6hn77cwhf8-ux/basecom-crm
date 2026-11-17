import { and, inArray, asc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { DEFAULT_PROPOSAL_CHANNELS, lisbonDay, nextWorkingMoment, pontoDay, proposalValue, saleTypesError, type SaleTypes } from "@basecom/shared";
import type { Db } from "../db/client.js";
import { auditLog, companies, companyNotes, opportunities, tasks, timeEntries, users } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";
import { getSetting } from "../settings.js";
import { notify, notifyLeadOrAdmin } from "../notifications/service.js";
import { canSee, visibleUserIds } from "../teams/service.js";
import { incomingStats } from "../phone/service.js";
import { docsReminders } from "../opportunities/service.js";

/**
 * Estados do comercial e registo de ponto (catálogo, secção 14).
 * A aplicação envia um sinal de vida a cada minuto; se fechar sem sair, o período termina no último sinal.
 */
export type State = "working" | "training" | "break" | "switch" | "office" | "client" | "support";
export const STATE_LABEL: Record<State, string> = {
  working: "A trabalhar", training: "Formação", break: "Intervalo", switch: "Mudança de campanha",
  office: "Office", client: "Em cliente", support: "Apoio",
};
export const STATES = Object.keys(STATE_LABEL) as State[];
/** Em cliente: proposta ou venda num cliente concreto, com o código da oportunidade na NOS. */
export type WorkKind = "proposal" | "sale";
export const WORK_KIND_LABEL: Record<WorkKind, string> = { proposal: "Proposta", sale: "Venda" };
export const OP_CODE = /^\d{7}$/;
const LEADS = ["admin", "team_lead"];
const STALE_MS = 3 * 60_000;

async function openEntry(db: Db, userId: string) {
  return (await db.select().from(timeEntries).where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endedAt))).orderBy(asc(timeEntries.startedAt)))[0];
}

/** Fecha períodos abertos sem sinal de vida há mais de 3 minutos (aplicação fechada ou sem rede). */
export async function closeStale(db: Db, now = new Date()) {
  await db.update(timeEntries).set({ endedAt: sql`${timeEntries.lastSeenAt}` })
    .where(and(isNull(timeEntries.endedAt), lt(timeEntries.lastSeenAt, new Date(now.getTime() - STALE_MS))));
}

type ClientWork = { companyId: string; opCode: string; kind: WorkKind };

/**
 * Estado atual (fecha o anterior e abre o novo).
 * Formação: só o Chefe de Equipa e o Administrador (para si ou para alguém da equipa). Apoio: só o Chefe de Equipa e o Administrador.
 * Office: até ao limite do dia. Em cliente: só com startClient (empresa e OP).
 */
export async function setState(db: Db, actor: PublicUser, userId: string, state: State | "off", work?: ClientWork) {
  if (actor.id !== userId) {
    if (actor.role === "sales") throw new AuthError(403, "Só o Chefe de Equipa ou o Administrador podem mudar o estado de outra pessoa.");
    if (!(await canSee(db, actor, userId))) throw new AuthError(403, "Esta pessoa não é da sua equipa.");
    if (state === "working") {
      // Terminar a formação de alguém da equipa (volta a «A trabalhar»; o Power Dialer recomeça a contar).
      const cur = await openEntry(db, userId);
      if (cur?.state !== "training") throw new AuthError(409, "Esta pessoa não está em formação.");
    } else if (state !== "training") throw new AuthError(400, "Pode apenas pôr ou tirar outra pessoa de formação.");
  } else {
    // Formação marcada pelo responsável: só o responsável a termina.
    if (state !== "training" && state !== "off" && !LEADS.includes(actor.role)) {
      const cur = await openEntry(db, userId);
      if (cur?.state === "training") throw new AuthError(409, "Está em formação. O Chefe de Equipa ou o Administrador termina a formação.");
    }
    if (state === "training" && !LEADS.includes(actor.role)) throw new AuthError(403, "A formação é marcada pelo Chefe de Equipa ou pelo Administrador.");
    if (state === "support" && !LEADS.includes(actor.role)) throw new AuthError(403, "O Apoio é só do Chefe de Equipa e do Administrador.");
    if (state === "client" && !work) throw new AuthError(400, "Escolha a empresa e indique a OP.");
  }
  await closeStale(db);
  const now = new Date();
  const cur = await openEntry(db, userId);
  if (cur && cur.state === state && state !== "client") { await db.update(timeEntries).set({ lastSeenAt: now }).where(eq(timeEntries.id, cur.id)); return; }
  if (state === "office") {
    const d = await daySummary(db, userId, now);
    if (d.seconds.office >= d.limits.officeSeconds) throw new AuthError(409, "Já usou todo o tempo de Office de hoje.");
  }
  await db.transaction(async (tx) => {
    if (cur) {
      await tx.update(timeEntries).set({ endedAt: now, lastSeenAt: now }).where(eq(timeEntries.id, cur.id));
      // Fim do trabalho em cliente: fica no histórico da empresa com o tempo e a OP.
      if (cur.state === "client" && cur.companyId) {
        const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
        const min = Math.max(1, Math.round((now.getTime() - cur.startedAt.getTime()) / 60_000));
        const what = cur.workKind === "sale" ? "Venda elaborada" : "Proposta elaborada";
        await tx.insert(companyNotes).values({ companyId: cur.companyId, kind: "client_work", text: `${what} · ${min} min · OP ${cur.opCode} · ${u?.name ?? ""}`, userId, at: now });
      }
    }
    if (state !== "off") await tx.insert(timeEntries).values({
      userId, state, startedAt: now, lastSeenAt: now, setBy: actor.id === userId ? null : actor.id,
      companyId: work?.companyId ?? null, opCode: work?.opCode ?? null, workKind: work?.kind ?? null,
    });
    if (actor.id !== userId) await tx.insert(auditLog).values({ userId: actor.id, action: "estado_alterado", entity: "user", entityId: userId, details: STATE_LABEL[state as State] });
  });
}

/**
 * Começar trabalho em cliente (proposta ou venda): depois de uma chamada ou sem chamada.
 * A OP (7 algarismos) é obrigatória. Sem chamada, numa proposta, a oportunidade do CRM fica em «Proposta enviada» com a OP.
 */
export async function startClient(db: Db, user: PublicUser, input: { companyId: string; kind: WorkKind; opCode: string; withOpportunity?: boolean }) {
  const op = input.opCode.trim();
  if (!OP_CODE.test(op)) throw new AuthError(400, "A OP tem 7 algarismos.");
  const co = await db.query.companies.findFirst({ where: eq(companies.id, input.companyId) });
  if (!co) throw new AuthError(404, "Empresa não encontrada.");
  if (input.withOpportunity) {
    const now = new Date();
    const open = (await db.select().from(opportunities).where(and(eq(opportunities.companyId, co.id), sql`${opportunities.stage} not in ('won','lost')`)).orderBy(sql`${opportunities.createdAt} desc`))[0];
    if (open) {
      const stage = input.kind === "proposal" && ["interest", "survey"].includes(open.stage) ? "proposal" : open.stage;
      await db.update(opportunities).set({ nosOp: op, stage, lastActivityAt: now }).where(eq(opportunities.id, open.id));
    } else if (input.kind === "proposal") {
      await db.insert(opportunities).values({ companyId: co.id, ownerId: co.ownerId ?? user.id, stage: "proposal", nosOp: op });
    }
  }
  await setState(db, user, user.id, "client", { companyId: co.id, opCode: op, kind: input.kind });
  return daySummary(db, user.id);
}

export type CloseClientInput = { saleTypes: SaleTypes; channel?: string; nextAction?: string; at?: string; comment?: string };

/**
 * «Guardar e fechar» (17 nov 2026): fecha o trabalho em cliente com os dados da proposta ou venda
 * (tipos e valor obrigatórios; na proposta também o canal de envio, a próxima ação e a data) e volta a «A trabalhar».
 */
export async function endClient(db: Db, user: PublicUser, input?: CloseClientInput) {
  const cur = await openEntry(db, user.id);
  if (cur?.state !== "client") return daySummary(db, user.id);
  if (cur.companyId && cur.opCode) {
    if (!input) throw new AuthError(400, "Preencha os dados da proposta para guardar e fechar.");
    const err = saleTypesError(input.saleTypes ?? {});
    if (err) throw new AuthError(400, err);
    const isProposal = cur.workKind !== "sale";
    const rules = (await getSetting(db, "catalogs")).opportunities;
    const channels = rules.channels ?? DEFAULT_PROPOSAL_CHANNELS;
    if (isProposal && !channels.includes(input.channel ?? "")) throw new AuthError(400, "Indique o canal por onde enviou a proposta.");
    if (isProposal && (!input.at || !input.nextAction?.trim())) throw new AuthError(400, "Indique a próxima ação e a respetiva data.");
    const now = new Date();
    const value = proposalValue(input.saleTypes);
    const companyId = cur.companyId, op = cur.opCode;
    await db.transaction(async (tx) => {
      const co = await tx.query.companies.findFirst({ where: eq(companies.id, companyId) });
      let opp = (await tx.select().from(opportunities).where(and(eq(opportunities.companyId, companyId), eq(opportunities.nosOp, op))).orderBy(sql`${opportunities.createdAt} desc`))[0];
      if (!opp) [opp] = await tx.insert(opportunities).values({ companyId, ownerId: co?.ownerId ?? user.id, stage: isProposal ? "proposal" : "won", nosOp: op, ...(isProposal ? {} : { closedAt: now }) }).returning();
      await tx.update(opportunities).set({ saleTypes: input.saleTypes, proposedValue: String(value), ...(input.channel ? { sentChannel: input.channel } : {}), lastActivityAt: now }).where(eq(opportunities.id, opp!.id));
      const eur = value.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const types = Object.keys(input.saleTypes).join(" + ");
      await tx.insert(companyNotes).values({ companyId, kind: "note", userId: user.id, at: now,
        text: `${isProposal ? "Proposta enviada" : "Venda"} · OP ${op} · ${types} · ${eur} €/mês${input.channel ? ` · por ${input.channel}` : ""}${input.comment?.trim() ? ` · ${input.comment.trim()}` : ""}` });
      if (input.at && input.nextAction?.trim()) await tx.insert(tasks).values({ companyId, type: "Ligar", assignedTo: co?.ownerId ?? user.id, dueAt: nextWorkingMoment(new Date(input.at)), description: input.nextAction.trim(), origin: "call", opportunityId: opp!.id, createdBy: user.id });
    });
  }
  await setState(db, user, user.id, "working");
  return daySummary(db, user.id);
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
    // Office no limite do dia: o tempo fecha e passa sozinho a «A trabalhar».
    if (cur.state === "office") {
      const d = await daySummary(db, user.id);
      if (d.seconds.office >= d.limits.officeSeconds) { await setState(db, user, user.id, "working"); return "working" as State; }
    }
    // Em cliente: alerta ao Chefe de Equipa a cada X minutos (sem limite de tempo).
    if (cur.state === "client") await clientAlert(db, user, cur);
    // Oportunidades paradas em «Aguarda docs»: tarefa automática «Pedir documentos».
    await docsReminders(db, user.id).catch(() => undefined);
    return cur.state as State;
  }
  await setState(db, user, user.id, "working");
  return "working" as State;
}

async function clientAlert(db: Db, user: PublicUser, cur: typeof timeEntries.$inferSelect, now = new Date()) {
  const lim = await getSetting(db, "timeLimits");
  const every = (lim.clientAlertMinutes ?? 10) * 60_000;
  const n = Math.floor((now.getTime() - cur.startedAt.getTime()) / every);
  if (n < 1) return;
  const co = cur.companyId ? await db.query.companies.findFirst({ where: eq(companies.id, cur.companyId), columns: { name: true, nif: true } }) : null;
  await notifyLeadOrAdmin(db, user.id, {
    kind: "client_long", companyId: cur.companyId ?? undefined, dedupeKey: `client:${cur.id}:${n}`,
    text: `${user.name} está em cliente há ${n * (lim.clientAlertMinutes ?? 10)} min · ${co?.name ?? ""} · NIF ${co?.nif ?? "—"} · OP ${cur.opCode ?? "—"}`,
  });
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
  const secs: Record<State, number> = { working: 0, training: 0, break: 0, switch: 0, office: 0, client: 0, support: 0 };
  let ownTraining = 0;
  for (const r of today) {
    const end = r.endedAt ?? now;
    const s = Math.max(0, Math.round((end.getTime() - r.startedAt.getTime()) / 1000));
    secs[r.state as State] = (secs[r.state as State] ?? 0) + s;
    if (r.state === "training" && !r.setBy) ownTraining += s;
  }
  const lim = await getSetting(db, "timeLimits");
  const open = today.find((r) => !r.endedAt);
  // Office: o tempo fecha no limite (nunca passa dele).
  const officeLimit = (lim.officeMinutes ?? 15) * 60;
  if (secs.office > officeLimit) { secs.working += secs.office - officeLimit; secs.office = officeLimit; }
  const openCo = open?.state === "client" && open.companyId ? await db.query.companies.findFirst({ where: eq(companies.id, open.companyId), columns: { id: true, name: true, nif: true } }) : null;
  return {
    day, state: (open?.state ?? null) as State | null,
    entrada: today[0]?.startedAt ?? null, saida: open ? null : today.at(-1)?.endedAt ?? null,
    seconds: secs, total: Object.values(secs).reduce((a, b) => a + b, 0),
    limits: { breakSeconds: lim.breakMinutes * 60, trainingSeconds: lim.trainingMinutes * 60, switchSeconds: lim.campaignSwitchMinutes * 60, officeSeconds: officeLimit },
    /** Trabalho em cliente em curso (empresa, OP, tipo e início). */
    client: open?.state === "client" ? { companyId: open.companyId, company: openCo?.name ?? null, nif: openCo?.nif ?? null, opCode: open.opCode, kind: open.workKind as WorkKind, since: open.startedAt } : null,
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

/** Exportar o ponto (decisão de 16 nov): só o Administrador; uma linha por pessoa e por dia. */
export async function pontoRows(db: Db, actor: PublicUser, from: string, to: string) {
  if (actor.role !== "admin") throw new AuthError(403, "Só o Administrador exporta o ponto.");
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
