import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { DEFAULT_SCRIPTS, followUpLabel, type FollowUp, NSNR, callbackLimit, proposalValue, saleTypesError, type SaleTypes, lisbonDay, nboHead, nextContactFor, operatorRefusalNote, renderScript, spokenName, nextWorkingDayStart, nextWorkingMoment, type Outcome, type Reason } from "@basecom/shared";
import type { Db } from "../db/client.js";
import { auditLog, calls, campaignEntries, campaignMembers, campaigns, companies, companyContacts, companyNotes, opportunities, tasks, users, walletChanges } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";
import { getSetting } from "../settings.js";
import { markFormerClient } from "../companies/status.js";
import { callableNow, cancelPendingWork } from "../companies/cancel.js";
import { currentState, OP_CODE, setState, startClient, type WorkKind } from "../time/service.js";
import { notifyLeadOrAdmin } from "../notifications/service.js";
import { queueDial, queueHangup } from "../phone/service.js";

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
  // Matriz de permissões: «Trabalhar campanhas» — Comercial e Chefe de Equipa as atribuídas; Administrador todas.
  if (user.role !== "admin") {
    const member = await db.query.campaignMembers.findFirst({ where: and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, user.id)) });
    if (!member) throw new AuthError(403, "Não está atribuído a esta campanha.");
  }

  // Callbacks (17 nov, opção a): à hora marcada, o callback do comercial vem à frente de tudo, seja qual for a campanha.
  const cb = await db.execute(sql`update campaign_entries set locked_by = ${user.id}::uuid, locked_until = ${minutes(LOCK_MINUTES)}
    where id = (
      select e.id from campaign_entries e join campaigns k on k.id = e.campaign_id join companies c on c.id = e.company_id
      where e.assigned_to = ${user.id}::uuid and e.status = 'pending' and e.next_at <= now() and k.status = 'active' and e.last_outcome in ('call_later', 'followup_call')
        and (e.locked_until is null or e.locked_until < now() or e.locked_by = ${user.id}::uuid)
        and ${callableNow}
        and not exists (select 1 from campaign_entries o where o.company_id = e.company_id and o.id <> e.id and o.locked_by <> ${user.id}::uuid and o.locked_until > now())
      order by e.next_at, e.id limit 1 for update of e skip locked)
    returning id`);
  const cbId = (cb.rows[0] as { id?: string } | undefined)?.id;
  if (cbId) return entryView(db, user, cbId);

  // Primeiro as agendadas que já chegaram (as minhas antes das do conjunto comum), depois as novas.
  const r = await db.execute(sql`update campaign_entries set locked_by = ${user.id}::uuid, locked_until = ${minutes(LOCK_MINUTES)}
    where id = (
      select e.id from campaign_entries e join companies c on c.id = e.company_id
      where e.campaign_id = ${campaignId}::uuid and e.status = 'pending'
        and (e.assigned_to is null or e.assigned_to = ${user.id}::uuid)
        and (e.next_at is null or e.next_at <= now())
        and (e.locked_until is null or e.locked_until < now() or e.locked_by = ${user.id}::uuid)
        and ${callableNow}
        -- A mesma empresa pode estar em várias campanhas: nunca a dá a duas pessoas ao mesmo tempo.
        and not exists (select 1 from campaign_entries o where o.company_id = e.company_id and o.id <> e.id and o.locked_by <> ${user.id}::uuid and o.locked_until > now())
      order by (e.locked_by = ${user.id}::uuid and e.locked_until >= now()) desc nulls last,
               -- Quarentena (todos os números sem resposta): só depois de todas as outras.
               e.quarantined,
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
  return buildView(db, user, co, e, k);
}

/**
 * Script grande para uma chamada recebida (20 nov): o da campanha onde a empresa está por trabalhar (a entrada fica
 * reservada a quem atendeu e o resultado conta nela) ou, sem campanha, o script por omissão (NN ou Cliente NOS).
 */
export async function companyScriptView(db: Db, user: PublicUser, companyId: string) {
  const co = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
  if (!co) throw new AuthError(404, "Empresa não encontrada.");
  const r = await db.execute(sql`select e.id from campaign_entries e join campaigns k on k.id = e.campaign_id
    where e.company_id = ${companyId}::uuid and e.status = 'pending' and k.status = 'active' and k.filters->>'system' is null
    order by (e.locked_by = ${user.id}::uuid) desc, (e.assigned_to = ${user.id}::uuid) desc, e.created_at limit 1`);
  const id = (r.rows[0] as { id?: string } | undefined)?.id;
  if (id) {
    await db.update(campaignEntries).set({ lockedBy: user.id, lockedUntil: minutes(LOCK_MINUTES) }).where(eq(campaignEntries.id, id));
    return entryView(db, user, id);
  }
  return buildView(db, user, co, null, null);
}

async function buildView(db: Db, user: PublicUser, co: typeof companies.$inferSelect, e: typeof campaignEntries.$inferSelect | null, k: typeof campaigns.$inferSelect | null) {
  const contacts = await db.select().from(companyContacts).where(eq(companyContacts.companyId, co.id)).orderBy(desc(companyContacts.isPrimary), companyContacts.createdAt);
  const phones = contacts.filter((x) => x.kind === "phone" && x.status === "valid");
  // Decisor principal: o indicado na chamada (contacto «pessoa» principal) vem primeiro.
  const people = contacts.filter((x) => x.personName && x.status !== "incorrect").sort((a, b) => Number(b.kind === "person" && b.isPrimary) - Number(a.kind === "person" && a.isPrimary));
  const owner = co.ownerId ? (await db.query.users.findFirst({ where: eq(users.id, co.ownerId) }))?.name ?? null : null;
  const history = await companyFeed(db, co.id, 12);
  // SMS «Tentámos ligar» (18 nov): só no 1.º não atende de cada empresa.
  const noAnswers = (await db.execute(sql`select count(*)::int as n from calls where company_id = ${co.id}::uuid and effect in ('no_answer', 'voicemail')`)).rows[0] as { n: number };
  const decisor1 = people[0] ? `${people[0].salutation ? people[0].salutation + " " : ""}${people[0].personName}` : "";
  const decisor2 = people.find((p) => p.personName !== people[0]?.personName);
  const vars = {
    comercial: user.name, empresa: co.name, campanha: k?.name ?? "", nbo: nboHead(co.nboCampaign),
    decisor1, decisor2: decisor2 ? `${decisor2.salutation ? decisor2.salutation + " " : ""}${decisor2.personName}` : "",
  };
  return {
    entry: e ? { id: e.id, attempts: e.attempts, lastOutcome: e.lastOutcome, assignedToMe: e.assignedTo === user.id } : { id: "", attempts: 0, lastOutcome: null, assignedToMe: false },
    campaign: k ? { id: k.id, name: k.name, mode: k.mode, dialMode: k.dialMode } : { id: "", name: "Sem campanha", mode: co.accountType === "client" ? "current" : "new", dialMode: "power" },
    company: { id: co.id, name: co.name, nif: co.nif, accountType: co.accountType, walletKind: co.walletKind, owner, municipality: co.municipality, operator: co.operator, loyaltyEnd: co.loyaltyEnd, l2bMonthly: co.l2bMonthly, district: co.district, loyaltyMonths: co.loyaltyMonths, walletKindConfirmed: co.walletKindConfirmed,
      needsKind: co.accountType === "client" && !co.ownerId && !co.walletKindConfirmed },
    phone: phones[0] ? { id: phones[0].id, value: phones[0].value, type: phones[0].phoneType } : null,
    otherPhones: phones.slice(1).map((p) => ({ id: p.id, value: p.value, type: p.phoneType })),
    script: renderScript(k?.script || DEFAULT_SCRIPTS.opening, { ...vars, decisor: spokenName(people[0]?.salutation, people[0]?.personName) }),
    // Dois passos: o ecrã mostra a abertura, confirma (ou muda) o decisor e passa à apresentação.
    scripts: {
      opening: k?.script || DEFAULT_SCRIPTS.opening,
      pitch: co.accountType === "client" ? k?.scriptPitchCurrent || DEFAULT_SCRIPTS.pitchCurrent : k?.scriptPitchNew || DEFAULT_SCRIPTS.pitchNew,
    },
    vars,
    people: [...new Map(people.map((p) => [p.personName!.toLowerCase(), { salutation: p.salutation, name: p.personName! }])).values()],
    decisors: [decisor1, decisor2?.personName].filter(Boolean),
    history,
    firstNoAnswer: noAnswers.n === 0,
  };
}

/**
 * Campanha de Novos clientes de cada comercial (Teste 1, ponto 13): decide o Administrador; o comercial não escolhe.
 * Sem escolha do Administrador, vale a única campanha ativa a que o comercial pertence.
 */
export async function myDialerCampaign(db: Db, user: PublicUser) {
  const u = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  const r = await db.execute(sql`select k.id from campaigns k join campaign_members m on m.campaign_id = k.id
    where m.user_id = ${user.id}::uuid and k.status = 'active' order by k.created_at`);
  const ids = (r.rows as { id: string }[]).map((x) => x.id);
  if (u?.dialerCampaignId && ids.includes(u.dialerCampaignId)) return u.dialerCampaignId;
  return ids.length === 1 ? ids[0]! : null;
}

/** O Administrador define a campanha de um comercial (passa a ser membro dela, se ainda não for). */
export async function setDialerCampaign(db: Db, by: PublicUser, userId: string, campaignId: string | null) {
  const u = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u) throw new AuthError(404, "Utilizador não encontrado.");
  let label = "nenhuma";
  if (campaignId) {
    const k = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
    label = k?.name ?? label;
    if (!k || k.status === "ended") throw new AuthError(400, "Escolha uma campanha ativa ou em pausa.");
    const m = await db.query.campaignMembers.findFirst({ where: and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, userId)) });
    if (!m) await db.insert(campaignMembers).values({ campaignId, userId });
  }
  await db.update(users).set({ dialerCampaignId: campaignId }).where(eq(users.id, userId));
  await db.insert(auditLog).values({ userId: by.id, action: "campanha_do_comercial", entity: "user", entityId: userId, details: label });
}

/** Lista para o Administrador: cada comercial e a campanha onde trabalha. */
export async function dialerAssignments(db: Db) {
  const r = await db.execute(sql`select u.id, u.name, u.role, u.dialer_campaign_id as "campaignId" from users u where u.active and u.role <> 'admin' order by u.name`);
  return r.rows as { id: string; name: string; role: string; campaignId: string | null }[];
}


/** Feedback anterior, mais recente primeiro: chamadas no CRM e histórico importado. */
export async function companyFeed(db: Db, companyId: string, limit = 20) {
  const r = await db.execute(sql`(
      select c.saved_at as at, u.name as "user", c.outcome_id as outcome, c.reason_id as reason, c.comment as text, 'call' as kind, false as imported
      from calls c join users u on u.id = c.user_id where c.company_id = ${companyId}::uuid and c.saved_at is not null
    ) union all (
      -- 26 nov: «Importado» só no que veio de uma importação (batch_id); o resto foi escrito no CRM.
      select n.at, case when n.batch_id is null then u.name else null end, null, null, n.text, n.kind, n.batch_id is not null
      from company_notes n left join users u on u.id = n.user_id where n.company_id = ${companyId}::uuid and n.kind in ('feedback', 'campaign', 'note')
    ) order by at desc limit ${limit}`);
  // Feedback anterior (18 nov): mostra sempre o resultado escolhido (e o motivo), antes do comentário.
  const cat = await getSetting(db, "catalogs");
  const label = (id: string | null, list: { id: string; label: string }[]) => (id ? list.find((x) => x.id === id)?.label ?? null : null);
  return (r.rows as { at: string; user: string | null; outcome: string | null; reason: string | null; text: string | null; kind: string; imported: boolean }[]).map(({ reason, ...x }) => (
    x.kind === "call" ? { ...x, text: [label(x.outcome, cat.outcomes as Outcome[]), label(reason, cat.reasons as Reason[]), x.text].filter(Boolean).join(" · ") || null } : x
  ));
}

/** Preview: saltar a empresa com motivo (fica no histórico); volta no dia útil seguinte. */
export async function skipEntry(db: Db, user: PublicUser, entryId: string, reason: string) {
  if (reason.trim().length < 5) throw new AuthError(400, "Indique o motivo para saltar.");
  const e = await db.query.campaignEntries.findFirst({ where: eq(campaignEntries.id, entryId) });
  if (!e || e.lockedBy !== user.id) throw new AuthError(404, "Empresa não reservada para si.");
  const k = (await db.query.campaigns.findFirst({ where: eq(campaigns.id, e.campaignId) }))!;
  const next = nextWorkingDayStart(new Date());
  await db.update(campaignEntries).set({ lockedBy: null, lockedUntil: null, nextAt: next }).where(eq(campaignEntries.id, entryId));
  await db.insert(companyNotes).values({ companyId: e.companyId, kind: "note", userId: user.id, text: `Saltada na campanha «${k.name}»: ${reason.trim()}` });
}

export async function releaseEntry(db: Db, user: PublicUser, entryId: string) {
  await db.update(campaignEntries).set({ lockedBy: null, lockedUntil: null }).where(and(eq(campaignEntries.id, entryId), eq(campaignEntries.lockedBy, user.id)));
}

export async function startCall(db: Db, user: PublicUser, input: { companyId: string; contactId?: string | null; entryId?: string | null; source: string; consultedNos?: boolean; phone?: string }) {
  // Fora de «A trabalhar» não se marcam chamadas de campanha; depois de mudar de campanha, a chamada volta a pôr a trabalhar.
  if (input.entryId) {
    const st = await currentState(db, user.id);
    if (st === "break" || st === "training" || st === "office" || st === "client") throw new AuthError(409, {
      break: "Está em intervalo. Volte a «A trabalhar» para ligar.", training: "Está em formação. O Chefe de Equipa ou o Administrador termina a formação.",
      office: "Está em Office. Volte a «A trabalhar» para ligar.", client: "Está em cliente. Carregue em «Terminar» para voltar a ligar.",
    }[st]);
    if (st !== "working") await setState(db, user, user.id, "working");
  }
  let phone: string | null = null;
  if (input.contactId) {
    const ct = await db.query.companyContacts.findFirst({ where: eq(companyContacts.id, input.contactId) });
    if (!ct || ct.companyId !== input.companyId) throw new AuthError(400, "Contacto inválido.");
    phone = ct.value;
  }
  if (!phone && input.source === "recebida" && input.phone) phone = input.phone.replace(/\D/g, "").slice(-9);

  let campaignId: string | null = null;
  if (input.entryId) {
    const e = await db.query.campaignEntries.findFirst({ where: eq(campaignEntries.id, input.entryId) });
    if (!e || e.companyId !== input.companyId) throw new AuthError(400, "Entrada de campanha inválida.");
    campaignId = e.campaignId;
    // Preview (clientes atuais): antes de ligar, o comercial confirma que consultou a NOS.
    const k = await db.query.campaigns.findFirst({ where: eq(campaigns.id, e.campaignId) });
    if (k?.dialMode === "preview" && !input.consultedNos) throw new AuthError(400, "Confirme «Consultei a NOS» antes de ligar.");
    await db.update(campaignEntries).set({ lockedBy: user.id, lockedUntil: minutes(LOCK_MINUTES * 3) }).where(eq(campaignEntries.id, e.id));
  }
  // Religar a mesma empresa antes de guardar o resultado (18 nov): a chamada anterior conta como a mesma (não entra no rating)
  // e o tempo de registo fica em pausa — continua de onde estava, não recomeça.
  let priorResultSeconds = 0;
  const prev = (await db.execute(sql`select id, ended_at as "endedAt", details from calls where user_id = ${user.id}::uuid and company_id = ${input.companyId}::uuid
    and saved_at is null and started_at > now() - interval '30 minutes' order by started_at desc limit 1`)).rows[0] as { id: string; endedAt: string | null; details: Record<string, unknown> | null } | undefined;
  if (prev) {
    const ended = prev.endedAt ? new Date(prev.endedAt) : new Date();
    priorResultSeconds = Number(prev.details?.priorResultSeconds ?? 0) + Math.max(0, Math.round((Date.now() - ended.getTime()) / 1000));
    await db.update(calls).set({ endedAt: ended, savedAt: new Date(), effect: "redial", outcomeId: null }).where(eq(calls.id, prev.id));
  }
  const details: Record<string, unknown> = {};
  if (input.consultedNos) details.consultedNos = true;
  if (prev) { details.priorResultSeconds = priorResultSeconds; details.redialOf = prev.id; }
  const [c0] = await db.insert(calls).values({ companyId: input.companyId, campaignId, entryId: input.entryId ?? null, userId: user.id, contactId: input.contactId ?? null, phone, source: input.source, details: Object.keys(details).length ? details : null }).returning({ id: calls.id, startedAt: calls.startedAt });
  // Com o telemóvel emparelhado e ligado, o próprio telemóvel marca o número (app BASECOM, Fase 4).
  // Chamada recebida (já atendida no telemóvel): não marca; o fim chega com o aviso do telemóvel.
  const viaPhone = input.source === "recebida" ? true : phone ? await queueDial(db, user.id, c0!.id, phone) : false;
  return { ...c0!, viaPhone, priorResultSeconds };
}

export async function endCall(db: Db, user: PublicUser, callId: string) {
  const c = await db.query.calls.findFirst({ where: eq(calls.id, callId) });
  if (!c || c.userId !== user.id) throw new AuthError(404, "Chamada não encontrada.");
  if (!c.endedAt) await db.update(calls).set({ endedAt: new Date() }).where(eq(calls.id, callId));
  // Chamada feita pelo telemóvel: o telemóvel desliga também.
  await queueHangup(db, user.id, callId);
  return { endedAt: c.endedAt ?? new Date() };
}

/** «Fechar sem registar» (18 nov): só numa chamada que não foi atendida (marcada por engano); não conta no dia. */
export async function discardCall(db: Db, user: PublicUser, callId: string) {
  const c = await db.query.calls.findFirst({ where: eq(calls.id, callId) });
  if (!c || c.userId !== user.id) throw new AuthError(404, "Chamada não encontrada.");
  if (c.savedAt) throw new AuthError(409, "O resultado desta chamada já foi registado.");
  if (c.answered) throw new AuthError(409, "A chamada foi atendida: registe o resultado.");
  if (!c.endedAt) await queueHangup(db, user.id, callId);
  await db.update(calls).set({ endedAt: c.endedAt ?? new Date(), savedAt: new Date(), effect: "discarded" }).where(eq(calls.id, callId));
  // Volta ao início da fila, sem contar tentativa (ex.: cancelada porque entrou uma chamada).
  if (c.entryId) await db.update(campaignEntries).set({ lockedBy: null, lockedUntil: null, nextAt: new Date() }).where(and(eq(campaignEntries.id, c.entryId), eq(campaignEntries.status, "pending")));
}

export type ResultInput = {
  outcomeId: string; reasonId?: string; comment?: string;
  /** Data indicada pelo comercial (fim da fidelização, data da renovação, callback, próxima ação). */
  date?: string; at?: string; forMe?: boolean; nextAction?: string; services?: string; decisorName?: string;
  competitor?: { operator?: string; renewalDate?: string; text?: string };
  /** Clientes NOS sem carteira e sem NC/FC: o comercial identifica no resultado. */
  /** NN (18 nov): afinal não é cliente → passa a ex-cliente. */
  walletKind?: "NC" | "FC" | "NN";
  /** «Mudar de decisor» na abertura: fica nos Contactos como decisor principal. */
  newDecisor?: { salutation?: string | null; name: string };
  /** Proposta enviada e Venda fechada: código da oportunidade na NOS (7 algarismos); a seguir começa o tempo «Em cliente». */
  opCode?: string;
  /** Proposta enviada e Venda fechada: tipos de venda e valor de cada um (€/mês), para o Pipeline e a previsão de pontos. */
  saleTypes?: SaleTypes;
  /** Próxima ação (18 nov): follow-up por chamada, SMS, email ou WhatsApp, com a data em «at». */
  followUp?: FollowUp;
};
/** Resultados que pedem a OP e abrem o trabalho em cliente. */
export const CLIENT_WORK: Record<string, WorkKind> = { proposal_sent: "proposal", sale: "sale" };

/** Recusas por outro operador (fidelizado ou renovou): a nova abordagem é na data que o cliente sugerir, não automática. */
const OPERATOR_REASONS = ["loyalty_end", "new_contract"];
/** Resultados sem conversa com o cliente. */
export const NO_CONTACT = ["no_answer", "busy", "voicemail", "wrong_number"];

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
  if (outcome.effect === "call_later") {
    const lim = await getSetting(db, "timeLimits");
    if (new Date(input.at!) > callbackLimit(new Date(), lim.callbackMaxMonths ?? 1)) throw new AuthError(400, `O callback é no máximo a ${lim.callbackMaxMonths ?? 1} mês. Para mais tarde, registe como Recusa.`);
  }
  // Proposta enviada (17 nov): no resultado só a OP; a próxima ação, os tipos, o valor e o canal pedem-se ao «Guardar e fechar».
  if (["interested", "negotiating"].includes(outcome.effect) && (!input.at || !input.followUp)) throw new AuthError(400, "Escolha a próxima ação (follow-up) e a data.");
  const workKind = CLIENT_WORK[outcome.effect];
  if (workKind && !OP_CODE.test(input.opCode?.trim() ?? "")) throw new AuthError(400, "Indique a OP (7 algarismos), como no programa da NOS.");
  // Em negociação: o valor da proposta é obrigatório (sem valor não se contabiliza).
  if (outcome.effect === "negotiating") { const e = saleTypesError(input.saleTypes ?? {}); if (e) throw new AuthError(400, e); }
  if (reason && OPERATOR_REASONS.includes(reason.effect)) {
    if (!input.competitor?.operator) throw new AuthError(400, "Indique a operadora atual do cliente.");
    if (!input.date) throw new AuthError(400, "Indique a data de fim da fidelização.");
    // 20 nov: o fim de fidelização é sempre uma data futura (a partir de amanhã), exceto NS/NR.
    if (input.date !== NSNR && input.date <= lisbonDay(new Date())) throw new AuthError(400, "O fim de fidelização tem de ser uma data futura.");
  }

  const now = new Date();
  const endedAt = call.endedAt ?? now;
  const resultSeconds = Math.max(0, Math.round((now.getTime() - endedAt.getTime()) / 1000)) + Number((call.details as { priorResultSeconds?: number } | null)?.priorResultSeconds ?? 0);
  const co = (await db.query.companies.findFirst({ where: eq(companies.id, call.companyId) }))!;
  // NC/FC só se pede quando houve conversa (não se pede num «Não atendeu», «Ocupado», voicemail ou número errado).
  const needsKind = co.accountType === "client" && !co.ownerId && !co.walletKindConfirmed && !NO_CONTACT.includes(outcome.effect);
  if (needsKind && !input.walletKind) throw new AuthError(400, "Cliente sem NC/FC: identifique se é NC ou FC.");
  const entry = call.entryId ? await db.query.campaignEntries.findFirst({ where: eq(campaignEntries.id, call.entryId) }) : undefined;
  const a = cat.attempts;
  const taskOwner = co.ownerId ?? user.id;
  const summary: string[] = [];

  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await tx.update(calls).set({
      endedAt, outcomeId: outcome.id, effect: outcome.effect, reasonId: reason?.id ?? null, comment: input.comment?.trim() || null,
      details: { ...((call.details as Record<string, unknown> | null) ?? {}), date: input.date, at: input.at, forMe: input.forMe, nextAction: input.nextAction, followUp: input.followUp, services: input.services, decisorName: input.decisorName, competitor: input.competitor },
      savedAt: now, resultSeconds,
    }).where(eq(calls.id, callId));

    if (needsKind && input.walletKind && input.walletKind !== "NN") {
      await tx.update(companies).set({ walletKind: input.walletKind, walletKindConfirmed: true, updatedAt: now }).where(eq(companies.id, co.id));
      await tx.insert(companyNotes).values({ companyId: co.id, kind: "wallet", text: `Identificada como ${input.walletKind}.`, userId: user.id });
    }
    if (input.newDecisor?.name.trim()) {
      const nd = { salutation: input.newDecisor.salutation?.trim() || null, name: input.newDecisor.name.trim() };
      const people = await tx.select().from(companyContacts).where(and(eq(companyContacts.companyId, co.id), sql`${companyContacts.personName} is not null`));
      const same = people.find((p) => p.personName!.toLowerCase() === nd.name.toLowerCase());
      await tx.update(companyContacts).set({ isPrimary: false }).where(and(eq(companyContacts.companyId, co.id), eq(companyContacts.kind, "person")));
      if (same?.kind === "person") await tx.update(companyContacts).set({ isPrimary: true, salutation: nd.salutation ?? same.salutation }).where(eq(companyContacts.id, same.id));
      else if (!same || same.kind !== "person") await tx.insert(companyContacts).values({ companyId: co.id, kind: "person", value: nd.name, personName: nd.name, salutation: nd.salutation, isPrimary: true });
      await tx.insert(companyNotes).values({ companyId: co.id, kind: "note", userId: user.id, text: `Novo decisor indicado na chamada: ${nd.salutation ? nd.salutation + " " : ""}${nd.name}` });
    }
    // Decisor indicado em «Decisor ausente».
    if (input.decisorName?.trim()) await tx.insert(companyNotes).values({ companyId: co.id, kind: "note", userId: user.id, text: `Decisor: ${input.decisorName.trim()}` });
    // Chamada atendida: os contactos e o decisor ficam confirmados (a importação deixa de os alterar).
    if (!NO_CONTACT.includes(outcome.effect) || input.newDecisor) await tx.update(companies).set({ contactsLockedAt: sql`coalesce(${companies.contactsLockedAt}, now())` }).where(eq(companies.id, co.id));
    // Primeira chamada atendida: a empresa sai das outras campanhas onde estava por trabalhar (fica só nesta).
    if (entry && !NO_CONTACT.includes(outcome.effect)) {
      await tx.update(campaignEntries).set({ status: "removed", lockedBy: null, lockedUntil: null })
        .where(and(eq(campaignEntries.companyId, co.id), eq(campaignEntries.status, "pending"), sql`${campaignEntries.id} <> ${entry.id}::uuid`));
    }
    // 20 nov: resultado com conversa fora da campanha (ficha, chamada recebida): a empresa sai de todas as campanhas
    // (como se fosse no Ligar). Um callback ou follow-up criado neste resultado entra a seguir.
    if (!entry && !NO_CONTACT.includes(outcome.effect)) {
      await tx.update(campaignEntries).set({ status: "done", lastOutcome: outcome.id, lastAttemptAt: now, lockedBy: null, lockedUntil: null })
        .where(and(eq(campaignEntries.companyId, co.id), eq(campaignEntries.status, "pending")));
    }
    // 26 nov: nova conversa sem recusa (callback, interesse, proposta…): o prazo de uma recusa antiga deixa de valer.
    if (!NO_CONTACT.includes(outcome.effect) && !["not_interested", "company_closed", "do_not_contact", "redial", "discarded"].includes(outcome.effect) && co.campaignEligibleFrom)
      await tx.update(companies).set({ campaignEligibleFrom: null }).where(eq(companies.id, co.id));
    const note = [outcome.label, reason?.label, input.comment?.trim()].filter(Boolean).join(" · ");
    await tx.insert(companyNotes).values({ companyId: co.id, kind: "call", text: note, userId: user.id });
    if (input.competitor && (input.competitor.operator || input.competitor.text)) {
      const cp = input.competitor;
      await tx.insert(companyNotes).values({ companyId: co.id, kind: "note", userId: user.id, text: `Outra operadora: ${[cp.operator, (input.date ?? cp.renewalDate) && `fim de fidelização ${input.date ?? cp.renewalDate}`, cp.text].filter(Boolean).join(" · ")}` });
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
      // 18 nov: a empresa nunca sai da fila por tentativas — vai para o fim (quarentena) e fica lá.
      if (attempts >= a.maxAttemptsTotal) { await quarantine(); return; }
      const next = todays >= a.maxAttemptsPerDay ? nextWorkingDayStart(now) : nextWorkingMoment(minutes(minutesLater, now));
      await setEntry({ attempts, nextAt: next });
      summary.push(`Nova tentativa ${next.toISOString()}`);
    };
    /**
     * Não atende / voicemail (18 nov): ao fim de X tentativas sem resposta (4) o número fica em quarentena e entra o seguinte;
     * sem mais números, a empresa vai para o fim da fila (volta a tentar todos os números quando lá chegar).
     */
    const noReply = async (label: string) => {
      if (call.contactId) {
        const ct = await tx.query.companyContacts.findFirst({ where: eq(companyContacts.id, call.contactId) });
        const since = ct?.noReplyResetAt ?? new Date(0);
        const n = (await tx.select({ id: calls.id }).from(calls).where(and(eq(calls.contactId, call.contactId), inArray(calls.effect, ["no_answer", "voicemail"]), sql`${calls.startedAt} >= ${since.toISOString()}::timestamptz`))).length;
        if (n >= a.maxVoicemailsPerNumber) {
          await tx.update(companyContacts).set({ status: "exhausted", statusNote: label }).where(eq(companyContacts.id, call.contactId));
          await tx.insert(companyNotes).values({ companyId: co.id, kind: "note", userId: user.id, text: `${ct?.value ?? "Número"}: ${label.toLowerCase()} (${n} tentativas) — passa ao número seguinte.` });
          summary.push(`Número em quarentena (${label})`);
          if (await anotherValidPhone()) { await setEntry({ attempts: (entry?.attempts ?? 0) + 1, nextAt: nextWorkingMoment(minutes(a.noAnswerRetryMinutes, now)) }); return; }
          await quarantine(); return;
        }
      }
      await retry(a.noAnswerRetryMinutes);
    };
    /** Todos os números sem resposta: fim da fila, com os números outra vez disponíveis para a próxima volta. */
    const quarantine = async () => {
      await tx.update(companyContacts).set({ status: "valid", noReplyResetAt: now }).where(and(eq(companyContacts.companyId, co.id), eq(companyContacts.kind, "phone"), eq(companyContacts.status, "exhausted")));
      await setEntry({ attempts: 0, nextAt: null, quarantined: true });
      summary.push("Sem resposta em nenhum número: vai para o fim da fila");
    };
    const anotherValidPhone = async () => (await tx.select({ id: companyContacts.id }).from(companyContacts)
      .where(and(eq(companyContacts.companyId, co.id), eq(companyContacts.kind, "phone"), eq(companyContacts.status, "valid")))).length > 0;
    const leaveAllCampaigns = () => tx.update(campaignEntries).set({ status: "removed", lockedBy: null, lockedUntil: null }).where(and(eq(campaignEntries.companyId, co.id), eq(campaignEntries.status, "pending")));
    const task = (type: string, dueAt: Date, description: string, assignedTo = taskOwner, opportunityId?: string) =>
      tx.insert(tasks).values({ companyId: co.id, type, assignedTo, dueAt, description, origin: "call", callId, opportunityId: opportunityId ?? null, createdBy: user.id });
    const opportunity = async (stage: string) => {
      const open = (await tx.select().from(opportunities).where(and(eq(opportunities.companyId, co.id), sql`${opportunities.stage} not in ('won','lost')`)).orderBy(desc(opportunities.createdAt)))[0];
      const nosOp = workKind ? input.opCode!.trim() : undefined;
      const value = input.saleTypes && !saleTypesError(input.saleTypes) ? { saleTypes: input.saleTypes, proposedValue: String(proposalValue(input.saleTypes)) } : {};
      if (open) { await tx.update(opportunities).set({ stage, services: input.services ?? open.services, lastActivityAt: now, ...(stage !== open.stage ? { stageChangedAt: now } : {}), ...(nosOp ? { nosOp } : {}), ...value }).where(eq(opportunities.id, open.id)); return open.id; }
      const [o] = await tx.insert(opportunities).values({ companyId: co.id, ownerId: co.ownerId ?? user.id, stage, services: input.services ?? null, nosOp: nosOp ?? null, ...value }).returning({ id: opportunities.id });
      return o!.id;
    };

    switch (outcome.effect) {
      case "no_answer": await noReply("Não atende permanentemente"); break;
      case "busy": await retry(a.busyRetryMinutes); break;
      case "decisor_absent":
        await retry(a.noAnswerRetryMinutes, false); break;
      case "voicemail": await noReply("Voicemail permanente"); break;
      case "wrong_number":
        if (call.contactId) await tx.update(companyContacts).set({ status: "incorrect" }).where(eq(companyContacts.id, call.contactId));
        if (await anotherValidPhone()) { await setEntry({ nextAt: null }); summary.push("Próxima passagem usa o número seguinte"); }
        else { await setEntry({ status: "exhausted" }); summary.push("Sem contacto válido"); }
        break;
      case "call_later": {
        // Callbacks (17 nov): não vão para a Agenda; voltam à fila do mesmo comercial à hora marcada, à frente de tudo.
        // Sem campanha (ficha, chamada recebida): entram na campanha automática «Callbacks».
        const at = nextWorkingMoment(new Date(input.at!));
        if (entry) await setEntry({ assignedTo: user.id, nextAt: at });
        else {
          const kId = await callbacksCampaign(t, user.id);
          await tx.update(campaignEntries).set({ status: "removed" }).where(and(eq(campaignEntries.campaignId, kId), eq(campaignEntries.companyId, co.id), eq(campaignEntries.status, "pending")));
          await tx.insert(campaignEntries).values({ campaignId: kId, companyId: co.id, assignedTo: user.id, nextAt: at, lastOutcome: "call_later", lastAttemptAt: now });
        }
        summary.push(`Callback ${at.toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`);
        break;
      }
      case "not_interested": {
        await setEntry({ status: "done" });
        // 26 nov: a recusa anula tudo o que estava em espera (outras campanhas, callbacks, «Não atende», tarefas de vendas)
        // e fecha a oportunidade em curso como Perdida, com o mesmo motivo.
        await cancelPendingWork(tx as unknown as Db, co.id, { exceptEntryId: entry?.id });
        await tx.update(opportunities).set({ stage: "lost", lostReasonId: reason!.id, closedAt: now, closedBy: user.id, closedVia: "call", lastActivityAt: now })
          .where(and(eq(opportunities.companyId, co.id), sql`${opportunities.stage} not in ('won','lost')`));
        const r = reason!;
        // NS/NR (cliente não refere o fim da fidelização): sem data; o contacto fica para daqui a X meses (6 por omissão).
        const known = input.date && input.date !== NSNR ? input.date : null;
        const base = known ? new Date(`${known}T00:00:00Z`) : null;
        const byOperator = OPERATOR_REASONS.includes(r.effect);
        // Por outra operadora: só a data de fim; o contacto fica marcado X meses antes (4 por omissão, configurável).
        const nc = nextContactFor(r, now, base);
        if (byOperator) await tx.insert(companyNotes).values({ companyId: co.id, kind: "note", userId: user.id, text: operatorRefusalNote(input.competitor!.operator!, known, r.monthsBefore ?? 4, r.unknownMonths ?? 6) });
        const patch: Partial<typeof companies.$inferInsert> = {};
        if (byOperator && known) patch.loyaltyEnd = known;
        if (byOperator && input.competitor?.operator && input.competitor.operator !== NSNR) patch.operator = input.competitor.operator;
        if (nc.eligibleAt) patch.campaignEligibleFrom = nc.eligibleAt.toISOString().slice(0, 10);
        if (r.effect === "company_closed") { patch.inactive = true; await leaveAllCampaigns(); }
        // Insatisfeito NOS: como o RGPD, mas até uma data — sai de todas as campanhas e não volta antes dela.
        if (r.effect === "dissatisfied" && nc.eligibleAt) { patch.dissatisfiedUntil = nc.eligibleAt.toISOString().slice(0, 10); await leaveAllCampaigns(); }
        if (Object.keys(patch).length) await tx.update(companies).set({ ...patch, updatedAt: now }).where(eq(companies.id, co.id));
        if (nc.at && (r.effect !== "cooldown")) await task("Ligar", nextWorkingMoment(nc.at), `Primeiro contacto após «${r.label}»`);
        if (r.effect === "other" && input.at) await task("Ligar", nextWorkingMoment(new Date(input.at)), input.comment!.trim());
        summary.push(`Fora da campanha: ${r.label}`);
        break;
      }
      case "interested": case "proposal_sent": case "negotiating": {
        const stage = outcome.effect === "interested" ? "interest" : outcome.effect === "proposal_sent" ? "proposal" : "negotiation";
        const oppId = await opportunity(stage);
        if (input.at && input.followUp) {
          // Follow-up chamada: volta à fila do comercial à hora marcada; SMS, email e WhatsApp: Agenda.
          if (input.followUp === "call") { await queueFollowUp(tx as unknown as Db, co.id, user.id, nextWorkingMoment(new Date(input.at)), entry?.id); summary.push("Follow-up chamada na sua fila"); break; }
          await task(followUpLabel(input.followUp), nextWorkingMoment(new Date(input.at)), followUpLabel(input.followUp), co.ownerId ?? user.id, oppId);
        }
        await setEntry({ status: "done" });
        summary.push(input.at ? "Oportunidade e tarefa de seguimento criadas" : "Oportunidade criada");
        break;
      }
      case "sale": {
        // Conquista da carteira no fecho do primeiro negócio (fluxo 5.1); o registo da venda chega no Arranque B.
        if (!co.ownerId) {
          await tx.update(companies).set({ ownerId: user.id, updatedAt: now }).where(eq(companies.id, co.id));
          await tx.insert(walletChanges).values({ companyId: co.id, toOwnerId: user.id, kind: "conquest", effectiveFrom: now.toISOString().slice(0, 10), status: "applied", reason: "Primeira venda", createdBy: user.id, appliedAt: now });
          summary.push("Empresa conquistada para a sua carteira");
        }
        await cancelPendingWork(tx as unknown as Db, co.id, { exceptEntryId: entry?.id });
        await opportunity("won").then((id) => tx.update(opportunities).set({ closedAt: now, closedBy: user.id, closedVia: "call" }).where(eq(opportunities.id, id)));
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
  // Excesso no registo do resultado: avisa o Chefe de Equipa (e o Administrador, enquanto não há equipas).
  // NN na caixa NC/FC: a empresa já não é cliente NOS → ex-cliente (sai da base de clientes atuais).
  if (needsKind && input.walletKind === "NN") { await markFormerClient(db, user, co.id, "Indicado na chamada (NN)"); summary.push("Passou a ex-cliente"); }
  // Avisos (18 nov): o responsável só é avisado a partir dos 100 s (configurável); abaixo disso fica só registado.
  const lims = await getSetting(db, "timeLimits");
  const alertAt = lims.resultAlertSeconds ?? 100;
  if (resultSeconds > alertAt) await notifyLeadOrAdmin(db, user.id, { kind: "result_late", companyId: co.id, text: `${user.name} registou o resultado de ${co.name} em ${resultSeconds} s (aviso a partir de ${alertAt} s).` });
  // Proposta ou venda: começa logo o tempo «Em cliente» (sem limite; alertas ao Chefe de Equipa).
  if (workKind) { await startClient(db, user, { companyId: co.id, kind: workKind, opCode: input.opCode! }); summary.push(`Em cliente · OP ${input.opCode!.trim()}`); }
  return { outcome: outcome.label, resultSeconds, summary, clientWork: !!workKind };
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

/** Campanha automática «Callbacks» (escondida nas listas): recebe os callbacks feitos fora de uma campanha. */
export async function callbacksCampaign(db: Db, byUserId: string) {
  const r = await db.execute(sql`select id from campaigns where filters->>'system' = 'callbacks' limit 1`);
  const id = (r.rows[0] as { id?: string } | undefined)?.id;
  if (id) return id;
  const [k] = await db.insert(campaigns).values({ name: "Callbacks (automática)", mode: "new", status: "active", filters: { system: "callbacks" }, createdBy: byUserId }).returning({ id: campaigns.id });
  return k!.id;
}

/** Follow-up chamada: a empresa volta à fila do comercial à hora marcada (na mesma entrada ou na campanha «Callbacks»). */
export async function queueFollowUp(db: Db, companyId: string, userId: string, at: Date, entryId?: string | null) {
  if (entryId) {
    await db.update(campaignEntries).set({ status: "pending", assignedTo: userId, nextAt: at, lastOutcome: "followup_call", lockedBy: null, lockedUntil: null, lastAttemptAt: new Date() }).where(eq(campaignEntries.id, entryId));
    return;
  }
  const kId = await callbacksCampaign(db, userId);
  await db.update(campaignEntries).set({ status: "removed" }).where(and(eq(campaignEntries.campaignId, kId), eq(campaignEntries.companyId, companyId), eq(campaignEntries.status, "pending")));
  await db.insert(campaignEntries).values({ campaignId: kId, companyId, assignedTo: userId, nextAt: at, lastOutcome: "followup_call", lastAttemptAt: new Date() });
}
