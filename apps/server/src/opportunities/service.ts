import { and, desc, eq, sql } from "drizzle-orm";
import { OPPORTUNITY_STAGES, opportunityAlert, type OpportunityRules, type Reason } from "@basecom/shared";
import type { Db } from "../db/client.js";
import { auditLog, campaignEntries, companies, companyNotes, opportunities, walletChanges } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";
import { getSetting } from "../settings.js";
import { canSee, visibleUserIds } from "../teams/service.js";

/**
 * Oportunidades (catálogo, secção 3): etapas, regra dos sete dias (alerta ao 5.º, atrasada ao 7.º, nunca fecha sozinha),
 * ganha (conquista da carteira, como na venda pelo Ligar) e perdida com motivo obrigatório.
 * O comercial vê as suas; o Administrador vê todas.
 */

const LABEL = Object.fromEntries(OPPORTUNITY_STAGES.map((s) => [s.id, s.label])) as Record<string, string>;
const OPEN = OPPORTUNITY_STAGES.filter((s) => s.open).map((s) => s.id) as string[];

export async function listOpportunities(db: Db, user: PublicUser, opts: { ownerId?: string; closed?: boolean } = {}) {
  const visible = await visibleUserIds(db, user);
  if (opts.ownerId && visible && !visible.includes(opts.ownerId)) throw new AuthError(403, "Só vê as oportunidades da sua equipa.");
  const owners = opts.ownerId ? [opts.ownerId] : visible;
  const rules = (await getSetting(db, "catalogs")).opportunities as OpportunityRules;
  const r = await db.execute(sql`select o.id, o.stage, o.services, o.last_activity_at as "lastActivityAt", o.created_at as "createdAt", o.closed_at as "closedAt",
      o.lost_reason_id as "lostReasonId", o.company_id as "companyId", c.name as company, c.nif, c.l2b_monthly as "l2bMonthly", u.name as owner, o.owner_id as "ownerId",
      (select min(t.due_at) from tasks t where t.opportunity_id = o.id and t.status = 'open') as "nextTaskAt"
    from opportunities o join companies c on c.id = o.company_id join users u on u.id = o.owner_id
    where ${opts.closed ? sql`o.stage in ('won', 'lost') and o.closed_at > now() - interval '90 days'` : sql`o.stage not in ('won', 'lost')`}
      ${owners ? sql`and o.owner_id in (${sql.join(owners.map((w) => sql`${w}::uuid`), sql`, `)})` : sql``}
    order by o.last_activity_at asc limit 1000`);
  const now = new Date();
  return (r.rows as Record<string, unknown>[]).map((o) => ({
    ...(o as { id: string; stage: string; services: string | null; lastActivityAt: string; createdAt: string; closedAt: string | null; lostReasonId: string | null; companyId: string; company: string; nif: string; l2bMonthly: string | null; owner: string; ownerId: string; nextTaskAt: string | null }),
    stageLabel: LABEL[o.stage as string] ?? (o.stage as string),
    alert: OPEN.includes(o.stage as string) ? opportunityAlert(new Date(o.lastActivityAt as string), now, rules) : null,
  }));
}

async function load(db: Db, user: PublicUser, id: string) {
  const o = await db.query.opportunities.findFirst({ where: eq(opportunities.id, id) });
  if (!o || (o.ownerId !== user.id && !(user.role !== "sales" && (await canSee(db, user, o.ownerId))))) throw new AuthError(404, "Oportunidade não encontrada.");
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

export async function moveOpportunity(db: Db, user: PublicUser, id: string, stage: string, comment?: string) {
  const o = await load(db, user, id);
  if (!OPEN.includes(stage)) throw new AuthError(400, "Para fechar, use «Ganha» ou «Perdida».");
  await db.update(opportunities).set({ stage, lastActivityAt: new Date() }).where(eq(opportunities.id, id));
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
export async function winOpportunity(db: Db, user: PublicUser, id: string) {
  const o = await load(db, user, id);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(opportunities).set({ stage: "won", closedAt: now, lastActivityAt: now }).where(eq(opportunities.id, id));
    const co = (await tx.query.companies.findFirst({ where: eq(companies.id, o.companyId) }))!;
    if (!co.ownerId) {
      await tx.update(companies).set({ ownerId: o.ownerId, walletKindConfirmed: true, updatedAt: now }).where(eq(companies.id, co.id));
      await tx.insert(walletChanges).values({ companyId: co.id, toOwnerId: o.ownerId, kind: "conquest", effectiveFrom: now.toISOString().slice(0, 10), status: "applied", reason: "Primeira venda (oportunidade ganha)", createdBy: user.id, appliedAt: now });
    }
    await tx.insert(companyNotes).values({ companyId: o.companyId, kind: "note", userId: user.id, text: `Oportunidade ganha (${LABEL[o.stage]} → Ganha)` });
  });
}

/** Perdida: motivo obrigatório; volta às campanhas ao fim de seis meses, salvo prazo diferente do motivo. */
export async function loseOpportunity(db: Db, user: PublicUser, id: string, reasonId: string, comment?: string) {
  const o = await load(db, user, id);
  const cat = await getSetting(db, "catalogs");
  const reason = (cat.reasons as Reason[]).find((r) => r.id === reasonId && r.active);
  if (!reason) throw new AuthError(400, "Escolha o motivo da perda.");
  if (reason.effect === "other" && !comment?.trim()) throw new AuthError(400, "No motivo «Outro», a descrição é obrigatória.");
  const now = new Date();
  const days = reason.effect === "cooldown" ? reason.days ?? 0 : (cat.opportunities as OpportunityRules).lostReopenDays;
  const eligible = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  await db.transaction(async (tx) => {
    await tx.update(opportunities).set({ stage: "lost", lostReasonId: reason.id, closedAt: now, lastActivityAt: now }).where(eq(opportunities.id, id));
    if (reason.effect === "company_closed") {
      await tx.update(companies).set({ inactive: true, updatedAt: now }).where(eq(companies.id, o.companyId));
      await tx.update(campaignEntries).set({ status: "removed" }).where(and(eq(campaignEntries.companyId, o.companyId), eq(campaignEntries.status, "pending")));
    } else await tx.update(companies).set({ campaignEligibleFrom: eligible, updatedAt: now }).where(eq(companies.id, o.companyId));
    await tx.insert(companyNotes).values({ companyId: o.companyId, kind: "note", userId: user.id, text: `Oportunidade perdida: ${reason.label}${comment?.trim() ? ` · ${comment.trim()}` : ""}${reason.effect !== "company_closed" ? ` · volta às campanhas a ${eligible.split("-").reverse().join("/")}` : ""}` });
    await tx.insert(auditLog).values({ userId: user.id, action: "oportunidade_perdida", entity: "company", entityId: o.companyId, details: reason.label });
  });
}

/** Oportunidades de uma empresa (separador da ficha): abertas e fechadas, mais recentes primeiro. */
export async function companyOpportunities(db: Db, companyId: string) {
  const rows = await db.select().from(opportunities).where(eq(opportunities.companyId, companyId)).orderBy(desc(opportunities.createdAt));
  return rows.map((o) => ({ ...o, stageLabel: LABEL[o.stage] ?? o.stage }));
}
