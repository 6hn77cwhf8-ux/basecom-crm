import { and, desc, eq, sql } from "drizzle-orm";
import { cycleForDate, NSNR, proposalValue, saleTypesError, nosRevenue, OPPORTUNITY_STAGES, proposalPoints, type SaleTypes, nextContactFor, nextWorkingMoment, operatorRefusalNote, opportunityAlert, type OpportunityRules, type Reason } from "@basecom/shared";
import type { Db } from "../db/client.js";
import { auditLog, campaignEntries, companies, companyNotes, opportunities, tasks, walletChanges } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";
import { getSetting } from "../settings.js";
import { canSee, visibleUserIds } from "../teams/service.js";
import { cancelPendingWork } from "../companies/cancel.js";

/**
 * Oportunidades (catálogo, secção 3): etapas, regra dos sete dias (alerta ao 5.º, atrasada ao 7.º, nunca fecha sozinha),
 * ganha (conquista da carteira, como na venda pelo Ligar) e perdida com motivo obrigatório.
 * O comercial vê as suas; o Administrador vê todas.
 */

const LABEL = Object.fromEntries(OPPORTUNITY_STAGES.map((s) => [s.id, s.label])) as Record<string, string>;
const OPEN = OPPORTUNITY_STAGES.filter((s) => s.open).map((s) => s.id) as string[];
/** 23 nov: a partir de «Proposta enviada» a OP (7 algarismos) é obrigatória. */
export const NEEDS_OP = ["proposal", "negotiation", "documents", "won"];
const OP_CODE = /^\d{7}$/;
function checkOp(current: string | null, given?: string) {
  const op = given?.trim() || current;
  if (!op) throw new AuthError(400, "Indique a OP (7 algarismos) para passar a esta etapa.");
  if (!OP_CODE.test(op)) throw new AuthError(400, "A OP tem 7 algarismos.");
  return op;
}
/** Valores ao cêntimo (23 nov): arredonda cada tipo a 2 casas e valida os tipos. */
export function soldTypesOrError(t: SaleTypes) {
  const clean = Object.fromEntries(Object.entries(t).filter(([, v]) => v != null).map(([k, v]) => [k, Math.round(Number(v) * 100) / 100])) as SaleTypes;
  const err = saleTypesError(clean);
  if (err) throw new AuthError(400, err);
  return { soldTypes: clean, soldValue: String(proposalValue(clean)) };
}

export async function listOpportunities(db: Db, user: PublicUser, opts: { ownerId?: string; closed?: boolean } = {}) {
  const visible = await visibleUserIds(db, user);
  if (opts.ownerId && visible && !visible.includes(opts.ownerId)) throw new AuthError(403, "Só vê as oportunidades da sua equipa.");
  const owners = opts.ownerId ? [opts.ownerId] : visible;
  const rules = (await getSetting(db, "catalogs")).opportunities as OpportunityRules;
  const r = await db.execute(sql`select o.id, o.stage, o.services, o.nos_op as "nosOp", o.sale_types as "saleTypes", o.proposed_value as "proposedValue", o.sold_types as "soldTypes", o.sold_value as "soldValue", o.last_activity_at as "lastActivityAt", o.created_at as "createdAt", o.closed_at as "closedAt",
      o.lost_reason_id as "lostReasonId", o.company_id as "companyId", c.name as company, c.nif, c.l2b_monthly as "l2bMonthly", u.name as owner, u.photo as "ownerPhoto", o.owner_id as "ownerId",
      (select min(t.due_at) from tasks t where t.opportunity_id = o.id and t.status = 'open') as "nextTaskAt"
    from opportunities o join companies c on c.id = o.company_id join users u on u.id = o.owner_id
    where ${opts.closed ? sql`o.stage in ('won', 'lost') and o.closed_at > now() - interval '90 days'` : sql`o.stage not in ('won', 'lost')`}
      ${owners ? sql`and o.owner_id in (${sql.join(owners.map((w) => sql`${w}::uuid`), sql`, `)})` : sql``}
    order by o.last_activity_at asc limit 1000`);
  const now = new Date();
  return (r.rows as Record<string, unknown>[]).map((o) => ({
    ...(o as { id: string; stage: string; services: string | null; nosOp: string | null; saleTypes: Record<string, number> | null; proposedValue: string | null; soldTypes: SaleTypes | null; soldValue: string | null; ownerPhoto: string | null; lastActivityAt: string; createdAt: string; closedAt: string | null; lostReasonId: string | null; companyId: string; company: string; nif: string; l2bMonthly: string | null; owner: string; ownerId: string; nextTaskAt: string | null }),
    stageLabel: LABEL[o.stage as string] ?? (o.stage as string),
    alert: OPEN.includes(o.stage as string) ? opportunityAlert(new Date(o.lastActivityAt as string), now, rules) : null,
  }));
}

async function load(db: Db, user: PublicUser, id: string, anyOwner = false) {
  const o = await db.query.opportunities.findFirst({ where: eq(opportunities.id, id) });
  if (!o || (!anyOwner && o.ownerId !== user.id && !(user.role !== "sales" && (await canSee(db, user, o.ownerId))))) throw new AuthError(404, "Oportunidade não encontrada.");
  if (!OPEN.includes(o.stage)) throw new AuthError(409, "Esta oportunidade já está fechada.");
  return o;
}
const note = (db: Db, companyId: string, userId: string, text: string) => db.insert(companyNotes).values({ companyId, kind: "note", userId, text });

export async function createOpportunity(db: Db, user: PublicUser, input: { companyId: string; stage?: string; services?: string }) {
  const co = await db.query.companies.findFirst({ where: eq(companies.id, input.companyId) });
  if (!co) throw new AuthError(404, "Empresa não encontrada.");
  if (co.ownerId && co.ownerId !== user.id && user.role !== "admin") throw new AuthError(403, "Esta empresa é de outra carteira.");
  const stage = input.stage ?? "interest";
  if (!OPEN.includes(stage)) throw new AuthError(400, "Etapa inválida.");
  const open = await db.select({ id: opportunities.id }).from(opportunities).where(and(eq(opportunities.companyId, co.id), sql`${opportunities.stage} not in ('won', 'lost')`));
  if (open.length) throw new AuthError(409, "Esta empresa já tem uma oportunidade em curso.");
  const [o] = await db.insert(opportunities).values({ companyId: co.id, ownerId: co.ownerId ?? user.id, stage, services: input.services?.trim() || null }).returning();
  await note(db, co.id, user.id, `Oportunidade criada em «${LABEL[stage]}»${input.services?.trim() ? ` · ${input.services.trim()}` : ""}`);
  return o!;
}

export async function moveOpportunity(db: Db, user: PublicUser, id: string, stage: string, comment?: string, nosOp?: string) {
  const o = await load(db, user, id);
  if (!OPEN.includes(stage)) throw new AuthError(400, "Para fechar, use «Ganha» ou «Perdida».");
  const op = NEEDS_OP.includes(stage) ? checkOp(o.nosOp, nosOp) : nosOp?.trim() ? checkOp(null, nosOp) : o.nosOp;
  await db.update(opportunities).set({ stage, nosOp: op, lastActivityAt: new Date(), ...(stage !== o.stage ? { stageChangedAt: new Date() } : {}) }).where(eq(opportunities.id, id));
  await note(db, o.companyId, user.id, `Oportunidade: ${LABEL[o.stage]} → ${LABEL[stage]}${comment?.trim() ? ` · ${comment.trim()}` : ""}`);
}

/** Atividade relevante (contacto, envio, documentos…): recomeça a contagem dos sete dias. */
export async function logOpportunityActivity(db: Db, user: PublicUser, id: string, text: string, services?: string) {
  const o = await load(db, user, id);
  if (text.trim().length < 3) throw new AuthError(400, "Descreva a atividade.");
  await db.update(opportunities).set({ lastActivityAt: new Date(), ...(services !== undefined ? { services: services.trim() || null } : {}) }).where(eq(opportunities.id, id));
  await note(db, o.companyId, user.id, `Oportunidade (${LABEL[o.stage]}): ${text.trim()}`);
}

/** Ganha: negócio fechado. Se a empresa não tinha carteira, é conquistada (regra da primeira venda). O registo da venda chega com o Arranque B. */
export async function winOpportunity(db: Db, user: PublicUser, id: string, input: { soldTypes: SaleTypes; nosOp?: string }) {
  const o = await load(db, user, id);
  const op = checkOp(o.nosOp, input.nosOp);
  const sold = soldTypesOrError(input.soldTypes ?? {});
  const now = new Date();
  await db.transaction(async (tx) => {
    await cancelPendingWork(tx as unknown as Db, o.companyId);
    await tx.update(opportunities).set({ stage: "won", nosOp: op, ...sold, ...(o.saleTypes ? {} : { saleTypes: sold.soldTypes, proposedValue: sold.soldValue }), closedAt: now, closedBy: user.id, closedVia: "pipeline", lastActivityAt: now }).where(eq(opportunities.id, id));
    const co = (await tx.query.companies.findFirst({ where: eq(companies.id, o.companyId) }))!;
    if (!co.ownerId) {
      await tx.update(companies).set({ ownerId: o.ownerId, walletKindConfirmed: true, updatedAt: now }).where(eq(companies.id, co.id));
      await tx.insert(walletChanges).values({ companyId: co.id, toOwnerId: o.ownerId, kind: "conquest", effectiveFrom: now.toISOString().slice(0, 10), status: "applied", reason: "Primeira venda (oportunidade ganha)", createdBy: user.id, appliedAt: now });
    }
    await tx.insert(companyNotes).values({ companyId: o.companyId, kind: "note", userId: user.id, text: `Oportunidade ganha (${LABEL[o.stage]} → Ganha) · OP ${op} · venda ${Number(sold.soldValue).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/mês` });
  });
}

/** Perdida: motivo obrigatório; volta às campanhas ao fim de seis meses, salvo prazo diferente do motivo. */
export async function loseOpportunity(db: Db, user: PublicUser, id: string, reasonId: string, comment?: string, operatorInfo?: { operator?: string; date?: string }, via: "pipeline" | "client" = "pipeline") {
  // Em cliente (23 nov): quem está a trabalhar a empresa fecha-a, mesmo que a oportunidade seja de outra carteira.
  const o = await load(db, user, id, via === "client");
  const cat = await getSetting(db, "catalogs");
  const reason = (cat.reasons as Reason[]).find((r) => r.id === reasonId && r.active);
  if (!reason) throw new AuthError(400, "Escolha o motivo da perda.");
  if (reason.effect === "other" && !comment?.trim()) throw new AuthError(400, "No motivo «Outro», a descrição é obrigatória.");
  const now = new Date();
  // Outra operadora (igual à recusa): operadora e fim de fidelização; contacto X meses antes do fim.
  const byOperator = reason.effect === "loyalty_end" || reason.effect === "new_contract";
  if (byOperator && (!operatorInfo?.operator || !operatorInfo.date)) throw new AuthError(400, "Indique a operadora e a data de fim da fidelização.");
  const known = byOperator && operatorInfo!.date !== NSNR ? operatorInfo!.date! : null;
  const nc = byOperator ? nextContactFor(reason, now, known ? new Date(`${known}T00:00:00Z`) : null) : null;
  const days = reason.effect === "cooldown" ? reason.days ?? 0 : (cat.opportunities as OpportunityRules).lostReopenDays;
  const eligible = (nc?.eligibleAt ?? new Date(now.getTime() + days * 86_400_000)).toISOString().slice(0, 10);
  await db.transaction(async (tx) => {
    // 26 nov: Perdida anula tudo o que estava em espera (campanhas, callbacks, «Não atende», tarefas da oportunidade).
    await cancelPendingWork(tx as unknown as Db, o.companyId);
    await tx.update(opportunities).set({ stage: "lost", lostReasonId: reason.id, closedAt: now, closedBy: user.id, closedVia: via, lastActivityAt: now }).where(eq(opportunities.id, id));
    if (reason.effect === "company_closed") {
      await tx.update(companies).set({ inactive: true, updatedAt: now }).where(eq(companies.id, o.companyId));
      await tx.update(campaignEntries).set({ status: "removed" }).where(and(eq(campaignEntries.companyId, o.companyId), eq(campaignEntries.status, "pending")));
    } else await tx.update(companies).set({ campaignEligibleFrom: eligible, ...(byOperator && known ? { loyaltyEnd: known } : {}), ...(byOperator && operatorInfo!.operator !== NSNR ? { operator: operatorInfo!.operator } : {}), updatedAt: now }).where(eq(companies.id, o.companyId));
    if (byOperator) {
      await tx.insert(companyNotes).values({ companyId: o.companyId, kind: "note", userId: user.id, text: operatorRefusalNote(operatorInfo!.operator!, known, reason.monthsBefore ?? 4, reason.unknownMonths ?? 6) });
      if (nc?.at) await tx.insert(tasks).values({ companyId: o.companyId, type: "Ligar", assignedTo: o.ownerId, dueAt: nextWorkingMoment(nc.at), description: `Primeiro contacto após «${reason.label}»`, origin: "opportunity", opportunityId: o.id, createdBy: user.id });
    }
    await tx.insert(companyNotes).values({ companyId: o.companyId, kind: "note", userId: user.id, text: `Oportunidade perdida: ${reason.label}${comment?.trim() ? ` · ${comment.trim()}` : ""}${reason.effect !== "company_closed" ? ` · volta às campanhas a ${eligible.split("-").reverse().join("/")}` : ""}` });
    await tx.insert(auditLog).values({ userId: user.id, action: "oportunidade_perdida", entity: "company", entityId: o.companyId, details: reason.label });
  });
}

/** Oportunidades de uma empresa (separador da ficha): abertas e fechadas, mais recentes primeiro. */
export async function companyOpportunities(db: Db, companyId: string) {
  const rows = await db.select().from(opportunities).where(eq(opportunities.companyId, companyId)).orderBy(desc(opportunities.createdAt));
  return rows.map((o) => ({ ...o, stageLabel: LABEL[o.stage] ?? o.stage }));
}

/**
 * «Aguarda docs» (17 nov): ao fim de X dias (2 por omissão) nessa etapa, cria uma única tarefa «Pedir documentos»
 * para o responsável, com a indicação de enviar o lembrete ao cliente. Corre no sinal de vida de cada pessoa.
 */
export async function docsReminders(db: Db, userId: string, now = new Date()) {
  const cat = await getSetting(db, "catalogs");
  const days = (cat.opportunities as OpportunityRules).docsTaskDays ?? 2;
  const since = new Date(now.getTime() - days * 86_400_000);
  const due = await db.execute(sql`select o.id, o.company_id as "companyId", o.owner_id as "ownerId" from opportunities o
    where o.owner_id = ${userId}::uuid and o.stage = 'documents' and o.stage_changed_at <= ${since}
      and not exists (select 1 from tasks t where t.opportunity_id = o.id and t.type = 'Pedir documentos' and t.created_at >= o.stage_changed_at)`);
  for (const o of due.rows as { id: string; companyId: string; ownerId: string }[]) {
    await db.insert(tasks).values({ companyId: o.companyId, type: "Pedir documentos", assignedTo: o.ownerId, dueAt: nextWorkingMoment(now), origin: "opportunity", opportunityId: o.id,
      description: `Automático: ${days} dias em «Aguarda docs». Enviar lembrete ao cliente (Mensagem › Lembrete de documentos).` });
  }
  return due.rows.length;
}

/** Previsão de pontos das propostas abertas de uma pessoa (tipos e valores indicados; FC a 50 %). */
export async function openProposalPoints(db: Db, userId: string) {
  const r = await db.execute(sql`select o.sale_types as "saleTypes", c.wallet_kind as "walletKind" from opportunities o join companies c on c.id = o.company_id
    where o.owner_id = ${userId}::uuid and o.stage not in ('won', 'lost') and o.sale_types is not null`);
  return (r.rows as { saleTypes: SaleTypes; walletKind: "NC" | "FC" }[]).reduce((a, x) => a + proposalPoints(x.saleTypes, x.walletKind), 0);
}

/**
 * Números do Pipeline (20 nov): OPs abertas, em atraso, ganhas e perdidas no ciclo atual — quantidade e valor.
 * Comercial e Chefe de Equipa: valor em pontos (NN 6 · XSell 3 · FID 1 · Upsell 0,5; FC 50 %).
 * Administrador: valor em € pela Receita NOS (multiplicadores configuráveis; FC metade). Por pessoa, por equipa e total.
 */
export async function pipelineStats(db: Db, user: PublicUser) {
  const visible = await visibleUserIds(db, user);
  const rules = (await getSetting(db, "catalogs")).opportunities as OpportunityRules;
  const cycle = cycleForDate(new Date());
  const metric: "eur" | "points" = user.role === "admin" ? "eur" : "points";
  const mult = metric === "eur" ? await getSetting(db, "nosRevenue") : null;
  const r = await db.execute(sql`select o.stage, case when o.stage = 'won' then coalesce(o.sold_types, o.sale_types) else o.sale_types end as "saleTypes", c.wallet_kind as "walletKind", o.closed_at as "closedAt", o.last_activity_at as "lastActivityAt",
      o.owner_id as "ownerId", u.name as owner, u.photo, t.name as team
    from opportunities o join companies c on c.id = o.company_id join users u on u.id = o.owner_id
      left join team_members tm on tm.user_id = o.owner_id left join teams t on t.id = tm.team_id
    where (o.stage not in ('won', 'lost') or o.closed_at >= ${cycle.start.toISOString()}::timestamptz)
      ${visible ? sql`and o.owner_id in (${sql.join(visible.map((w) => sql`${w}::uuid`), sql`, `)})` : sql``}`);
  type Row = { stage: string; saleTypes: SaleTypes | null; walletKind: "NC" | "FC"; closedAt: string | null; lastActivityAt: string; ownerId: string; owner: string; photo: string | null; team: string | null };
  type Agg = { open: number; openValue: number; late: number; won: number; wonValue: number; lost: number; lostValue: number };
  const empty = (): Agg => ({ open: 0, openValue: 0, late: 0, won: 0, wonValue: 0, lost: 0, lostValue: 0 });
  const total = empty();
  const byUser = new Map<string, Agg & { id: string; name: string; photo: string | null; team: string | null }>();
  const byTeam = new Map<string, Agg & { name: string }>();
  const now = new Date();
  for (const x of r.rows as Row[]) {
    const value = !x.saleTypes ? 0 : metric === "eur" ? nosRevenue(x.saleTypes, x.walletKind, mult!) : proposalPoints(x.saleTypes, x.walletKind);
    const u = byUser.get(x.ownerId) ?? { ...empty(), id: x.ownerId, name: x.owner, photo: x.photo, team: x.team };
    byUser.set(x.ownerId, u);
    const teamName = x.team ?? "Sem equipa";
    const tm = byTeam.get(teamName) ?? { ...empty(), name: teamName };
    byTeam.set(teamName, tm);
    for (const a of [total, u, tm]) {
      if (x.stage === "won") { a.won++; a.wonValue += value; }
      else if (x.stage === "lost") { a.lost++; a.lostValue += value; }
      else {
        a.open++; a.openValue += value;
        if (opportunityAlert(new Date(x.lastActivityAt), now, rules).level === "late") a.late++;
      }
    }
  }
  const round = <T extends Agg>(a: T) => ({ ...a, openValue: Math.round(a.openValue * 100) / 100, wonValue: Math.round(a.wonValue * 100) / 100, lostValue: Math.round(a.lostValue * 100) / 100 });
  return {
    metric, cycle: cycle.label, total: round(total),
    byUser: [...byUser.values()].map(round).sort((a, b) => a.name.localeCompare(b.name)),
    byTeam: user.role === "sales" ? [] : [...byTeam.values()].map(round).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
