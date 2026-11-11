/**
 * Catálogos operacionais (documento «Catálogos operacionais», tópico 2, decisões de 9 e 10 nov).
 * Valores por omissão; o Administrador altera-os nas Configurações. Os «efeitos» são estruturais
 * (o CRM sabe o que fazer com cada um); os textos, prazos, limites e a ordem são configuráveis.
 */

/** Botões do Power Dialer (secção 14) e resultados que cada um abre. */
export type OutcomeGroup = "refuse" | "callback" | "noanswer" | "proposal" | "sale" | "other";
export const OUTCOME_GROUPS: { id: OutcomeGroup; label: string; key: string }[] = [
  { id: "refuse", label: "Recusa", key: "1" },
  { id: "callback", label: "Callback", key: "2" },
  { id: "noanswer", label: "Não atende", key: "3" },
  { id: "proposal", label: "Proposta", key: "4" },
  { id: "sale", label: "Venda", key: "5" },
  { id: "other", label: "Outro", key: "6" },
];

/** O que o CRM faz automaticamente com cada resultado (secções 2.1 a 2.13). */
export type OutcomeEffect =
  | "no_answer" | "busy" | "voicemail" | "wrong_number"
  | "decisor_absent" | "call_later"
  | "not_interested"
  | "interested" | "proposal_sent" | "negotiating"
  | "sale"
  | "company_closed" | "do_not_contact" | "other_wallet";

export type Outcome = { id: string; label: string; group: OutcomeGroup; effect: OutcomeEffect; active: boolean };

export const DEFAULT_OUTCOMES: Outcome[] = [
  { id: "not_interested", label: "Sem interesse", group: "refuse", effect: "not_interested", active: true },
  { id: "call_later", label: "Ligar mais tarde", group: "callback", effect: "call_later", active: true },
  { id: "decisor_absent", label: "Decisor ausente", group: "callback", effect: "decisor_absent", active: true },
  { id: "no_answer", label: "Não atendeu", group: "noanswer", effect: "no_answer", active: true },
  { id: "busy", label: "Ocupado", group: "noanswer", effect: "busy", active: true },
  { id: "voicemail", label: "Caixa de correio / Voicemail", group: "noanswer", effect: "voicemail", active: true },
  { id: "wrong_number", label: "Número errado ou inexistente", group: "noanswer", effect: "wrong_number", active: true },
  { id: "interested", label: "Interessado", group: "proposal", effect: "interested", active: true },
  { id: "proposal_sent", label: "Proposta enviada", group: "proposal", effect: "proposal_sent", active: true },
  { id: "negotiating", label: "Em negociação", group: "proposal", effect: "negotiating", active: true },
  { id: "sale", label: "Venda fechada", group: "sale", effect: "sale", active: true },
  { id: "company_closed", label: "Empresa encerrada", group: "other", effect: "company_closed", active: true },
  { id: "do_not_contact", label: "Não contactar / Oposição", group: "other", effect: "do_not_contact", active: true },
  { id: "other_wallet", label: "Empresa de outra carteira", group: "other", effect: "other_wallet", active: true },
];

/** Tentativas (2.1 a 2.3). */
export type AttemptRules = {
  noAnswerRetryMinutes: number; busyRetryMinutes: number; maxAttemptsPerDay: number; maxAttemptsTotal: number; maxVoicemailsPerNumber: number;
};
export const DEFAULT_ATTEMPT_RULES: AttemptRules = { noAnswerRetryMinutes: 120, busyRetryMinutes: 30, maxAttemptsPerDay: 3, maxAttemptsTotal: 6, maxVoicemailsPerNumber: 4 };

/**
 * Motivos de recusa e de perda (3.4): o mesmo catálogo serve os dois contextos.
 * - cooldown: elegível para nova campanha após N dias;
 * - loyalty_end: registar o fim da fidelização; tarefa N meses antes do fim;
 * - new_contract: registar a data; contrato de M meses; tarefa N meses antes do fim;
 * - followup_task: tarefa de seguimento após N dias;
 * - company_closed: empresa inativa, sai de todas as campanhas;
 * - other: descrição obrigatória; o comercial define a tarefa e o prazo.
 */
export type ReasonEffect = "cooldown" | "loyalty_end" | "new_contract" | "followup_task" | "company_closed" | "other";
export type Reason = { id: string; label: string; effect: ReasonEffect; days?: number; monthsBefore?: number; contractMonths?: number; active: boolean };

export const DEFAULT_REASONS: Reason[] = [
  { id: "loyal_other", label: "Fidelizado a outra operadora", effect: "loyalty_end", monthsBefore: 6, active: true },
  { id: "chose_other", label: "Escolheu outra proposta ou renovou com outro operador", effect: "new_contract", contractMonths: 24, monthsBefore: 6, active: true },
  { id: "satisfied", label: "Satisfeito com a solução atual", effect: "cooldown", days: 90, active: true },
  { id: "price", label: "Preço", effect: "cooldown", days: 90, active: true },
  { id: "no_need", label: "Sem necessidade", effect: "cooldown", days: 180, active: true },
  { id: "decisor_undecided", label: "Decisor indisponível ou indeciso", effect: "followup_task", days: 30, active: true },
  { id: "no_coverage", label: "Sem cobertura ou viabilidade técnica", effect: "cooldown", days: 180, active: true },
  { id: "closed", label: "Empresa encerrada ou sem atividade", effect: "company_closed", active: true },
  { id: "other", label: "Outro", effect: "other", active: true },
];

/** Oportunidades (3.2 e 3.3). */
export type OpportunityRules = { warnDays: number; lateDays: number; lostReopenDays: number };
export const DEFAULT_OPPORTUNITY_RULES: OpportunityRules = { warnDays: 5, lateDays: 7, lostReopenDays: 180 };

/** Tipos de tarefa (7). */
export const DEFAULT_TASK_TYPES = ["Ligar", "Enviar proposta", "Pedir documentos", "Seguir pendência", "Responder a solicitação", "Reunião", "Outro"];

/** Operadoras para o «feedback de outra operadora» (ecrã de resultado). */
export const COMPETITOR_OPERATORS = ["NOS", "MEO", "Vodafone", "DIGI", "NOWO", "Outra"];

/**
 * Data do próximo contacto para um motivo de recusa (ex.: «Abr 2028 · 6 meses antes do fim dos 24 meses»).
 * `date` é a data indicada pelo comercial (fim da fidelização ou data da renovação).
 */
export function nextContactFor(reason: Reason, today: Date, date?: Date | null): { at: Date | null; eligibleAt: Date | null } {
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
  const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };
  switch (reason.effect) {
    case "cooldown": return { at: null, eligibleAt: addDays(today, reason.days ?? 0) };
    case "followup_task": return { at: addDays(today, reason.days ?? 0), eligibleAt: null };
    case "loyalty_end": {
      if (!date) return { at: null, eligibleAt: null };
      const at = addMonths(date, -(reason.monthsBefore ?? 0));
      return { at: at > today ? at : today, eligibleAt: at };
    }
    case "new_contract": {
      const base = date ?? today;
      const at = addMonths(base, (reason.contractMonths ?? 24) - (reason.monthsBefore ?? 0));
      return { at, eligibleAt: at };
    }
    default: return { at: null, eligibleAt: null };
  }
}
