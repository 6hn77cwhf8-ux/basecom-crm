import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { auditLog, campaignEntries, campaigns, companies, companyContacts, companyNotes, tasks, users } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";
import { getSetting } from "../settings.js";
import { startCall } from "../dialer/service.js";
import { daySummary } from "../time/service.js";

/**
 * Agenda (Fase 3, passo 5): tarefas de cada comercial — callbacks, seguimentos, próximas ações das oportunidades.
 * Visibilidade: o comercial vê as suas; o Administrador vê as de qualquer pessoa (o Chefe de Equipa, quando houver equipas).
 * Reagendar exige justificação e fica no histórico da empresa (catálogo, 3.2).
 */

export async function listAgenda(db: Db, user: PublicUser, opts: { userId?: string } = {}) {
  const who = user.role === "admin" ? opts.userId : user.id;
  const r = await db.execute(sql`select t.id, t.type, t.due_at as "dueAt", t.description, t.origin, t.status, t.opportunity_id as "opportunityId",
      t.company_id as "companyId", c.name as company, c.nif, c.municipality, u.name as "assignedName", t.assigned_to as "assignedTo",
      (select cc.value from company_contacts cc where cc.company_id = c.id and cc.kind = 'phone' and cc.status = 'valid' order by cc.is_primary desc, cc.created_at limit 1) as phone
    from tasks t join companies c on c.id = t.company_id join users u on u.id = t.assigned_to
    where t.status = 'open' ${who ? sql`and t.assigned_to = ${who}::uuid` : sql``}
    order by t.due_at limit 1000`);
  return r.rows as { id: string; type: string; dueAt: string; description: string | null; origin: string; status: string; opportunityId: string | null; companyId: string; company: string; nif: string; municipality: string | null; assignedName: string; assignedTo: string; phone: string | null }[];
}

async function loadTask(db: Db, user: PublicUser, id: string) {
  const t = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
  if (!t || (t.assignedTo !== user.id && user.role !== "admin")) throw new AuthError(404, "Tarefa não encontrada.");
  if (t.status !== "open") throw new AuthError(409, "Esta tarefa já foi fechada.");
  return t;
}

export async function createTask(db: Db, user: PublicUser, input: { companyId: string; type: string; dueAt: string; description?: string; assignedTo?: string }) {
  const cat = await getSetting(db, "catalogs");
  if (!(cat.taskTypes as string[]).includes(input.type)) throw new AuthError(400, "Tipo de tarefa desconhecido.");
  const assignedTo = input.assignedTo && user.role === "admin" ? input.assignedTo : user.id;
  const co = await db.query.companies.findFirst({ where: eq(companies.id, input.companyId) });
  if (!co) throw new AuthError(404, "Empresa não encontrada.");
  const [t] = await db.insert(tasks).values({ companyId: co.id, type: input.type, assignedTo, dueAt: new Date(input.dueAt), description: input.description?.trim() || null, origin: "manual", createdBy: user.id }).returning();
  await db.insert(companyNotes).values({ companyId: co.id, kind: "note", userId: user.id, text: `Tarefa criada: ${input.type} para ${fmt(new Date(input.dueAt))}${input.description?.trim() ? ` · ${input.description.trim()}` : ""}` });
  return t!;
}

export async function rescheduleTask(db: Db, user: PublicUser, id: string, dueAt: string, reason: string) {
  const t = await loadTask(db, user, id);
  if (reason.trim().length < 5) throw new AuthError(400, "Escreva a justificação do reagendamento.");
  const at = new Date(dueAt);
  if (at.getTime() < Date.now() - 60_000) throw new AuthError(400, "A nova data tem de ser futura.");
  await db.update(tasks).set({ dueAt: at }).where(eq(tasks.id, id));
  await db.insert(companyNotes).values({ companyId: t.companyId, kind: "note", userId: user.id, text: `Tarefa «${t.type}» reagendada de ${fmt(t.dueAt)} para ${fmt(at)}. Justificação: ${reason.trim()}` });
  await db.insert(auditLog).values({ userId: user.id, action: "tarefa_reagendada", entity: "task", entityId: id, details: reason.trim() });
}

export async function closeTask(db: Db, user: PublicUser, id: string, status: "done" | "cancelled", note?: string) {
  const t = await loadTask(db, user, id);
  if (status === "cancelled" && (note ?? "").trim().length < 5) throw new AuthError(400, "Indique porque cancela a tarefa.");
  await db.update(tasks).set({ status, doneAt: new Date() }).where(eq(tasks.id, id));
  await db.insert(companyNotes).values({ companyId: t.companyId, kind: "note", userId: user.id, text: `Tarefa «${t.type}» ${status === "done" ? "concluída" : "cancelada"}${note?.trim() ? `: ${note.trim()}` : ""}` });
}

/**
 * Ligar a partir da Agenda: se a empresa ainda está numa campanha ativa (para este comercial ou para todos),
 * a chamada fica ligada a essa entrada, para que o resultado tenha as mesmas consequências do Ligar.
 */
export async function callFromTask(db: Db, user: PublicUser, id: string) {
  const t = await loadTask(db, user, id);
  const [phone] = await db.select().from(companyContacts).where(and(eq(companyContacts.companyId, t.companyId), eq(companyContacts.kind, "phone"), eq(companyContacts.status, "valid")))
    .orderBy(sql`${companyContacts.isPrimary} desc`, asc(companyContacts.createdAt)).limit(1);
  const [entry] = await db.select({ id: campaignEntries.id }).from(campaignEntries).innerJoin(campaigns, eq(campaigns.id, campaignEntries.campaignId))
    .where(and(eq(campaignEntries.companyId, t.companyId), eq(campaignEntries.status, "pending"), eq(campaigns.status, "active"),
      sql`(${campaignEntries.assignedTo} is null or ${campaignEntries.assignedTo} = ${user.id}::uuid)`)).limit(1);
  const c = await startCall(db, user, { companyId: t.companyId, contactId: phone?.id ?? null, entryId: entry?.id ?? null, source: "agenda" });
  return { callId: c.id, phone: phone ? { id: phone.id, value: phone.value, type: phone.phoneType } : null };
}

/** Pessoas cujas agendas o Administrador pode consultar. */
export async function agendaPeople(db: Db) {
  return db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.active, true), inArray(users.role, ["sales", "team_lead", "admin"]))).orderBy(users.name);
}

const fmt = (d: Date) => d.toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * «O meu dia» (aparece quando o menu lateral recolhe): chamadas de hoje, contactos efetivos, propostas e vendas,
 * intervalo usado e as próximas tarefas da Agenda. Só os números do próprio.
 */
export async function myDay(db: Db, user: PublicUser) {
  const r = await db.execute(sql`select count(*)::int as calls,
      count(*) filter (where effect not in ('no_answer', 'busy', 'voicemail', 'wrong_number'))::int as effective,
      count(*) filter (where effect in ('interested', 'proposal_sent', 'negotiating'))::int as proposals,
      count(*) filter (where effect = 'sale')::int as sales
    from calls where user_id = ${user.id}::uuid and saved_at is not null
      and (saved_at at time zone 'Europe/Lisbon')::date = (now() at time zone 'Europe/Lisbon')::date`);
  const t = await daySummary(db, user.id);
  const next = (await listAgenda(db, user)).slice(0, 4).map((x) => ({ id: x.id, dueAt: x.dueAt, type: x.type, company: x.company, companyId: x.companyId }));
  const late = (await listAgenda(db, user)).filter((x) => new Date(x.dueAt) < new Date()).length;
  return { ...(r.rows[0] as { calls: number; effective: number; proposals: number; sales: number }), breakUsed: t.used.break, breakLimit: t.limits.breakSeconds, worked: t.seconds.working, loggedIn: t.total,
    // Chamadas recebidas: chegam com a app Android (Fase 4), que as devolve ao CRM.
    received: null as number | null, late, next };
}
