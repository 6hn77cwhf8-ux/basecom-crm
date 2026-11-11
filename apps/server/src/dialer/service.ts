import { and, desc, eq, sql } from "drizzle-orm";
import { lisbonDay, nextContactFor, nextWorkingDayStart, nextWorkingMoment, type Outcome, type Reason } from "@basecom/shared";
import type { Db } from "../db/client.js";
import { auditLog, calls, campaignEntries, campaignMembers, campaigns, companies, companyContacts, companyNotes, opportunities, tasks, users, walletChanges } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";
import { getSetting } from "../settings.js";

/**
 * Power Dialer (catálogo, secções 2 e 14): fila por comercial, chamadas e consequências automáticas.
 * Até existir o canal telefónico (Fase 4), o início e o fim da chamada são marcados no ecrã.
 */

const LOCK_MINUTES = 10;
const minutes = (n: number, from = new Date()) => new Date(from.getTime() + n * 60_000);

/** Próxima empresa da campanha para este comercial (reserva-a durante 10 minutos). */
export async function nextEntry(db: Db, user: PublicUser, campaignId: string) {
  const k = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
  if (!k) throw new AuthError(404, "Campanha não encontrada.");
  if (k.status !== "active") throw new AuthError(409, k.status === "paused" ? "A campanha está em pausa." : "A campanha terminou.");
  const member = await db.query.campaignMembers.findFirst({ where: and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, user.id)) });
  if (!member) throw new AuthError(403, "Não está atribuído a esta campanha.");

  // Primeiro as agendadas que já chegaram (as minhas antes das do conjunto comum), depois as novas.
  const r = await db.execute(sql`update campaign_entries set locked_by = ${user.id}::uuid, locked_until = ${minutes(LOCK_MINUTES)}
    where id = (
      select e.id from campaign_entries e join companies c on c.id = e.company_id
      where e.campaign_id = ${campaignId}::uuid and e.status = 'pending'
        and (e.assigned_to is null or e.assigned_to = ${user.id}::uuid)
        and (e.next_at is null or e.next_at <= now())
        and (e.locked_until is null or e.locked_until < now() or e.locked_by = ${user.id}::uuid)
        and not c.do_not_contact and not c.inactive
      order by (e.locked_by = ${user.id}::uuid and e.locked_until >= now()) desc nulls last,
               (e.next_at is not null) desc, (e.assigned_to is not null) desc, e.next_at nulls last, e.created_at, e.id
      limit 1 for update of e skip locked)
    returning id`);
  const id = (r.rows[0] as { id?: string } | undefined)?.id;
  if (!id) return null;
  return entryView(db, user, id);
}

/** Tudo o que o ecrã do Power Dialer precisa sobre a empresa da vez. */
export async function entryView(db: Db, user: PublicUser, entryId: string) {
  const e = await db.query.campaignEntries.findFirst({ where: eq(campaignEntries.id, entryId) });
  if (!e) throw new AuthError(404, "Empresa não encontrada na campanha.");
  const k = (await db.query.campaigns.findFirst({ where: eq(campaigns.id, e.campaignId) }))!;
  const co = (await db.query.companies.findFirst({ where: eq(companies.id, e.companyId) }))!;
  const contacts = await db.select().from(companyContacts).where(eq(companyContacts.companyId, co.id)).orderBy(desc(companyContacts.isPrimary), companyContacts.createdAt);
  const phones = contacts.filter((x) => x.kind === "phone" && x.status === "valid");
  const people = contacts.filter((x) => x.personName);
  const owner = co.ownerId ? (await db.query.users.findFirst({ where: eq(users.id, co.ownerId) }))?.name ?? null : null;
  const history = await companyFeed(db, co.id, 12);
  const decisor1 = people[0] ? `${people[0].salutation ? people[0].salutation + " " : ""}${people[0].personName}` : "";
  const decisor2 = people.find((p) => p.personName !== people[0]?.personName);
  return {
    entry: { id: e.id, attempts: e.attempts, lastOutcome: e.lastOutcome, assignedToMe: e.assignedTo === user.id },
    campaign: { id: k.id, name: k.name, mode: k.mode },
    company: { id: co.id, name: co.name, nif: co.nif, accountType: co.accountType, walletKind: co.walletKind, owner, municipality: co.municipality, operator: co.operator, loyaltyEnd: co.loyaltyEnd, l2bMonthly: co.l2bMonthly },
    phone: phones[0] ? { id: phones[0].id, value: phones[0].value, type: phones[0].phoneType } : null,
    otherPhones: phones.slice(1).map((p) => ({ id: p.id, value: p.value, type: p.phoneType })),
    script: renderScript(k.script, { comercial: user.name, empresa: co.name, decisor1, decisor2: decisor2 ? `${decisor2.salutation ? decisor2.salutation + " " : ""}${decisor2.personName}` : "" }),
    decisors: [decisor1, decisor2?.personName].filter(Boolean),
    history,
  };
}

export function renderScript(script: string, v: Record<string, string>) {
  return script.replace(/\{(comercial|empresa|decisor1|decisor2)\}/g, (_, k: string) => v[k] || `[${k === "comercial" ? "comercial" : k === "empresa" ? "empresa" : k === "decisor1" ? "decisor 1" : "decisor 2"}]`);
}

/** Feedback anterior, mais recente primeiro: chamadas no CRM e histórico importado. */
export async function companyFeed(db: Db, companyId: string, limit = 20) {
  const r = await db.execute(sql`(
      select c.saved_at as at, u.name as "user", c.outcome_id as outcome, c.comment as text, 'call' as kind
      from calls c join users u on u.id = c.user_id where c.company_id = ${companyId}::uuid and c.saved_at is not null
    ) union all (
      select n.at, case when n.batch_id is null then u.name else null end, null, n.text, n.kind
      from company_notes n left join users u on u.id = n.user_id where n.company_id = ${companyId}::uuid and n.kind in ('feedback', 'campaign', 'note')
    ) order by at desc limit ${limit}`);
  return r.rows as { at: string; user: string | null; outcome: string | null; text: string | null; kind: string }[];
}

export async function releaseEntry(db: Db, user: PublicUser, entryId: string) {
  await db.update(campaignEntries).set({ lockedBy: null, lockedUntil: null }).where(and(eq(campaignEntries.id, entryId), eq(campaignEntries.lockedBy, user.id)));
}

export async function startCall(db: Db, user: PublicUser, input: { companyId: string; contactId?: string | null; entryId?: string | null; source: string }) {
  let phone: string | null = null;
  if (input.contactId) {
    const ct = await db.query.companyContacts.findFirst({ where: eq(companyContacts.id, input.contactId) });
    if (!ct || ct.companyId !== input.companyId) throw new AuthError(400, "Contacto inválido.");
    phone = ct.value;
  }
  let campaignId: string | null = null;
  if (input.entryId) {
    const e = await db.query.campaignEntries.findFirst({ where: eq(campaignEntries.id, input.entryId) });
    if (!e || e.companyId !== input.companyId) throw new AuthError(400, "Entrada de campanha inválida.");
    campaignId = e.campaignId;
    await db.update(campaignEntries).set({ lockedBy: user.id, lockedUntil: minutes(LOCK_MINUTES * 3) }).where(eq(campaignEntries.id, e.id));
  }
  const [c] = await db.insert(calls).values({ companyId: input.companyId, campaignId, entryId: input.entryId ?? null, userId: user.id, contactId: input.contactId ?? null, phone, source: input.source }).returning({ id: calls.id, startedAt: calls.startedAt });
  return c!;
}

export async function endCall(db: Db, user: PublicUser, callId: string) {
  const c = await db.query.calls.findFirst({ where: eq(calls.id, callId) });
  if (!c || c.userId !== user.id) throw new AuthError(404, "Chamada não encontrada.");
  if (!c.endedAt) await db.update(calls).set({ endedAt: new Date() }).where(eq(calls.id, callId));
  return { endedAt: c.endedAt ?? new Date() };
}

export type ResultInput = {
  outcomeId: string; reasonId?: string; comment?: string;
  /** Data indicada pelo comercial (fim da fidelização, data da renovação, callback, próxima ação). */
  date?: string; at?: string; forMe?: boolean; nextAction?: string; services?: string; decisorName?: string;
  competitor?: { operator?: string; renewalDate?: string; text?: string };
};

/** Regista o resultado e executa as consequências automáticas do catálogo. */
export async function saveResult(db: Db, user: PublicUser, callId: string, input: ResultInput) {
  const call = await db.query.calls.findFirst({ where: eq(calls.id, callId) });
  if (!call || call.userId !== user.id) throw new AuthError(404, "Chamada não encontrada.");
  if (call.savedAt) throw new AuthError(409, "O resultado desta chamada já foi registado.");
  const cat = await getSetting(db, "catalogs");
  const outcome = (cat.outcomes as Outcome[]).find((o) => o.id === input.outcomeId && o.active);
  if (!outcome) throw new AuthError(400, "Resultado desconhecido.");
  const reason = input.reasonId ? (cat.reasons as Reason[]).find((r) => r.id === input.reasonId && r.active) : undefined;
  if (outcome.effect === "not_interested" && !reason) throw new AuthError(400, "Escolha o motivo da recusa.");
  if (reason?.effect === "other" && !input.comment?.trim()) throw new AuthError(400, "No motivo «Outro», a descrição é obrigatória.");
  if (outcome.effect === "call_later" && !input.at) throw new AuthError(400, "Indique a data e a hora para voltar a ligar.");
  if (["interested", "proposal_sent", "negotiating"].includes(outcome.effect) && (!input.at || !input.nextAction?.trim())) throw new AuthError(400, "Indique a próxima ação e a respetiva data.");

  const now = new Date();
  const endedAt = call.endedAt ?? now;
  const resultSeconds = Math.max(0, Math.round((now.getTime() - endedAt.getTime()) / 1000));
  const co = (await db.query.companies.findFirst({ where: eq(companies.id, call.companyId) }))!;
  const entry = call.entryId ? await db.query.campaignEntries.findFirst({ where: eq(campaignEntries.id, call.entryId) }) : undefined;
  const a = cat.attempts;
  const taskOwner = co.ownerId ?? user.id;
  const summary: string[] = [];

  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await tx.update(calls).set({
      endedAt, outcomeId: outcome.id, effect: outcome.effect, reasonId: reason?.id ?? null, comment: input.comment?.trim() || null,
      details: { date: input.date, at: input.at, forMe: input.forMe, nextAction: input.nextAction, services: input.services, decisorName: input.decisorName, competitor: input.competitor },
      savedAt: now, resultSeconds,
    }).where(eq(calls.id, callId));

    const note = [outcome.label, reason?.label, input.comment?.trim()].filter(Boolean).join(" · ");
    await tx.insert(companyNotes).values({ companyId: co.id, kind: "call", text: note, userId: user.id });
    if (input.competitor && (input.competitor.operator || input.competitor.text)) {
      const cp = input.competitor;
      await tx.insert(companyNotes).values({ companyId: co.id, kind: "note", userId: user.id, text: `Outra operadora: ${[cp.operator, cp.renewalDate && `renovação ${cp.renewalDate}`, cp.text].filter(Boolean).join(" · ")}` });
    }

    // Tentativas desta empresa nesta campanha, hoje (Lisboa).
    const today = lisbonDay(now);
    const todays = entry ? (await tx.select({ s: calls.startedAt }).from(calls).where(and(eq(calls.entryId, entry.id), sql`${calls.savedAt} is not null`))).filter((x) => lisbonDay(x.s) === today).length : 0;
    const setEntry = async (patch: Partial<typeof campaignEntries.$inferInsert>) => {
      if (!entry) return;
      await tx.update(campaignEntries).set({ lastAttemptAt: now, lastOutcome: outcome.id, lockedBy: null, lockedUntil: null, ...patch }).where(eq(campaignEntries.id, entry.id));
    };
    const retry = async (minutesLater: number, countAttempt = true) => {
      const attempts = (entry?.attempts ?? 0) + (countAttempt ? 1 : 0);
      if (attempts >= a.maxAttemptsTotal) { await setEntry({ attempts, status: "exhausted" }); summary.push(`Esgotada nesta campanha (${attempts} tentativas)`); return; }
      const next = todays >= a.maxAttemptsPerDay ? nextWorkingDayStart(now) : nextWorkingMoment(minutes(minutesLater, now));
      await setEntry({ attempts, nextAt: next });
      summary.push(`Nova tentativa ${next.toISOString()}`);
    };
    const anotherValidPhone = async () => (await tx.select({ id: companyContacts.id }).from(companyContacts)
      .where(and(eq(companyContacts.companyId, co.id), eq(companyContacts.kind, "phone"), eq(companyContacts.status, "valid")))).length > 0;
    const leaveAllCampaigns = () => tx.update(campaignEntries).set({ status: "removed", lockedBy: null, lockedUntil: null }).where(and(eq(campaignEntries.companyId, co.id), eq(campaignEntries.status, "pending")));
    const task = (type: string, dueAt: Date, description: string, assignedTo = taskOwner, opportunityId?: string) =>
      tx.insert(tasks).values({ companyId: co.id, type, assignedTo, dueAt, description, origin: "call", callId, opportunityId: opportunityId ?? null, createdBy: user.id });
    const opportunity = async (stage: string) => {
      const open = (await tx.select().from(opportunities).where(and(eq(opportunities.companyId, co.id), sql`${opportunities.stage} not in ('won','lost')`)).orderBy(desc(opportunities.createdAt)))[0];
      if (open) { await tx.update(opportunities).set({ stage, services: input.services ?? open.services, lastActivityAt: now }).where(eq(opportunities.id, open.id)); return open.id; }
      const [o] = await tx.insert(opportunities).values({ companyId: co.id, ownerId: co.ownerId ?? user.id, stage, services: input.services ?? null }).returning({ id: opportunities.id });
      return o!.id;
    };

    switch (outcome.effect) {
      case "no_answer": await retry(a.noAnswerRetryMinutes); break;
      case "busy": await retry(a.busyRetryMinutes); break;
      case "decisor_absent":
        if (input.decisorName?.trim()) await tx.insert(companyNotes).values({ companyId: co.id, kind: "note", userId: user.id, text: `Decisor: ${input.decisorName.trim()}` });
        await retry(a.noAnswerRetryMinutes, false); break;
      case "voicemail": {
        // Ao 4.º voicemail sem contacto efetivo, o número fica esgotado (continua com os outros números).
        if (call.contactId) {
          const vms = (await tx.select({ id: calls.id }).from(calls).where(and(eq(calls.contactId, call.contactId), eq(calls.effect, "voicemail")))).length;
          if (vms >= a.maxVoicemailsPerNumber) {
            await tx.update(companyContacts).set({ status: "exhausted" }).where(eq(companyContacts.id, call.contactId));
            summary.push("Número esgotado (voicemail)");
            if (!(await anotherValidPhone())) { await setEntry({ attempts: (entry?.attempts ?? 0) + 1, status: "exhausted" }); summary.push("Sem contacto válido"); break; }
          }
        }
        await retry(a.noAnswerRetryMinutes); break;
      }
      case "wrong_number":
        if (call.contactId) await tx.update(companyContacts).set({ status: "incorrect" }).where(eq(companyContacts.id, call.contactId));
        if (await anotherValidPhone()) { await setEntry({ nextAt: null }); summary.push("Próxima passagem usa o número seguinte"); }
        else { await setEntry({ status: "exhausted" }); summary.push("Sem contacto válido"); }
        break;
      case "call_later": {
        const at = nextWorkingMoment(new Date(input.at!));
        if (input.forMe) { await task("Ligar", at, input.comment?.trim() || "Ligar mais tarde (pedido do cliente)", user.id); await setEntry({ assignedTo: user.id, nextAt: at }); }
        else await setEntry({ nextAt: at });
        summary.push(`Ligar ${at.toISOString()}${input.forMe ? " (agendado para mim)" : ""}`);
        break;
      }
      case "not_interested": {
        await setEntry({ status: "done" });
        const r = reason!;
        const base = input.date ? new Date(`${input.date}T00:00:00Z`) : null;
        const nc = nextContactFor(r, now, base);
        const patch: Partial<typeof companies.$inferInsert> = {};
        if (r.effect === "loyalty_end" && input.date) patch.loyaltyEnd = input.date;
        if (nc.eligibleAt) patch.campaignEligibleFrom = nc.eligibleAt.toISOString().slice(0, 10);
        if (r.effect === "company_closed") { patch.inactive = true; await leaveAllCampaigns(); }
        if (Object.keys(patch).length) await tx.update(companies).set({ ...patch, updatedAt: now }).where(eq(companies.id, co.id));
        if (nc.at && (r.effect !== "cooldown")) await task("Ligar", nextWorkingMoment(nc.at), `Primeiro contacto após «${r.label}»`);
        if (r.effect === "other" && input.at) await task("Ligar", nextWorkingMoment(new Date(input.at)), input.comment!.trim());
        summary.push(`Fora da campanha: ${r.label}`);
        break;
      }
      case "interested": case "proposal_sent": case "negotiating": {
        const stage = outcome.effect === "interested" ? "interest" : outcome.effect === "proposal_sent" ? "proposal" : "negotiation";
        const oppId = await opportunity(stage);
        await task("Ligar", nextWorkingMoment(new Date(input.at!)), input.nextAction!.trim(), co.ownerId ?? user.id, oppId);
        await setEntry({ status: "done" });
        summary.push("Oportunidade e tarefa de seguimento criadas");
        break;
      }
      case "sale": {
        // Conquista da carteira no fecho do primeiro negócio (fluxo 5.1); o registo da venda chega no Arranque B.
        if (!co.ownerId) {
          await tx.update(companies).set({ ownerId: user.id, updatedAt: now }).where(eq(companies.id, co.id));
          await tx.insert(walletChanges).values({ companyId: co.id, toOwnerId: user.id, kind: "conquest", effectiveFrom: now.toISOString().slice(0, 10), status: "applied", reason: "Primeira venda", createdBy: user.id, appliedAt: now });
          summary.push("Empresa conquistada para a sua carteira");
        }
        await opportunity("won").then((id) => tx.update(opportunities).set({ closedAt: now }).where(eq(opportunities.id, id)));
        await setEntry({ status: "done" });
        break;
      }
      case "company_closed":
        await tx.update(companies).set({ inactive: true, updatedAt: now }).where(eq(companies.id, co.id));
        await leaveAllCampaigns(); summary.push("Empresa marcada como encerrada"); break;
      case "do_not_contact":
        await tx.update(companies).set({ doNotContact: true, updatedAt: now }).where(eq(companies.id, co.id));
        await tx.insert(auditLog).values({ userId: user.id, action: "nao_contactar_marcado", entity: "company", entityId: co.id, details: input.comment?.trim() || "Pedido do cliente numa chamada" });
        await leaveAllCampaigns(); summary.push("Bloqueada para todas as campanhas"); break;
      case "other_wallet":
        // Não altera o responsável; o responsável é informado com uma tarefa.
        if (co.ownerId && co.ownerId !== user.id) await task("Outro", now, `Contacto registado por ${user.name}: ${note}`, co.ownerId);
        await setEntry({ status: "removed" }); summary.push("Responsável informado"); break;
    }
    if (resultSeconds > (await getSetting(t, "timeLimits")).resultSeconds) summary.push(`Resultado registado em ${resultSeconds} s`);
  });
  return { outcome: outcome.label, resultSeconds, summary };
}

/** Tarefas abertas do comercial (Agenda): atrasadas primeiro. */
export async function myTasks(db: Db, user: PublicUser) {
  return db.select({ id: tasks.id, type: tasks.type, dueAt: tasks.dueAt, description: tasks.description, companyId: tasks.companyId, company: companies.name, nif: companies.nif, status: tasks.status })
    .from(tasks).innerJoin(companies, eq(companies.id, tasks.companyId)).where(and(eq(tasks.assignedTo, user.id), eq(tasks.status, "open"))).orderBy(tasks.dueAt).limit(500);
}

export async function completeTask(db: Db, user: PublicUser, id: string, status: "done" | "cancelled") {
  const t = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
  if (!t || (t.assignedTo !== user.id && user.role !== "admin")) throw new AuthError(404, "Tarefa não encontrada.");
  await db.update(tasks).set({ status, doneAt: new Date() }).where(eq(tasks.id, id));
}

