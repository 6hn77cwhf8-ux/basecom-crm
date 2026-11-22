import { eq } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_ATTEMPT_RULES, DEFAULT_OPERATORS, DEFAULT_OPPORTUNITY_RULES, DEFAULT_OUTCOMES, DEFAULT_REASONS, DEFAULT_TASK_TYPES, DEFAULT_MESSAGE_TEMPLATES, DEFAULT_PROPOSAL_CHANNELS, DEFAULT_SIGNATURE, DEFAULT_NOS_MULTIPLIERS } from "@basecom/shared";
import type { Db } from "./db/client.js";
import { auditLog, settings } from "./db/schema.js";
import { AuthError } from "./auth/errors.js";

/**
 * Configurações e valores iniciais. Os limites do Power Dialer foram aprovados (Fase 02);
 * as regras de entrada são propostas, editáveis pelo Administrador.
 */
export const SETTINGS = {
  auth: {
    schema: z.object({
      maxFailedLogins: z.number().int().min(3).max(20),
      lockMinutes: z.number().int().min(1).max(1440),
      sessionHours: z.number().int().min(1).max(72),
    }),
    defaults: { maxFailedLogins: 5, lockMinutes: 15, sessionHours: 12 },
  },
  timeLimits: {
    schema: z.object({
      resultSeconds: z.number().int().min(5).max(120),
      nextCallSeconds: z.number().int().min(0).max(120),
      campaignSwitchMinutes: z.number().int().min(0).max(60),
      trainingMinutes: z.number().int().min(0).max(120),
      breakMinutes: z.number().int().min(0).max(120),
      /** Horas previstas por dia (ponto): saldo e hora de saída prevista. */
      dailyMinutes: z.number().int().min(0).max(720).default(480),
      saturdayMinutes: z.number().int().min(0).max(720).default(255),
      /** Office (WhatsApp, SMS, emails, contratos): limite por dia; ao chegar, passa sozinho a «A trabalhar». */
      officeMinutes: z.number().int().min(0).max(240).default(15),
      /** Em cliente: alerta ao Chefe de Equipa a cada X minutos (o tempo não tem limite). */
      clientAlertMinutes: z.number().int().min(1).max(240).default(10),
      /** Callback («Ligar mais tarde»): no máximo X meses à frente; mais do que isso é recusa (decisão de 17 nov). */
      callbackMaxMonths: z.number().int().min(1).max(12).default(1),
      /** Aviso ao Chefe de Equipa/Administrador só quando o resultado demora mais do que isto (18 nov: 100 s). */
      resultAlertSeconds: z.number().int().min(15).max(600).default(100),
      /** Chamadas mais curtas do que isto não contam para o rating (18 nov: 5 s). */
      shortCallSeconds: z.number().int().min(0).max(60).default(5),
    }),
    defaults: { resultSeconds: 15, nextCallSeconds: 10, campaignSwitchMinutes: 2, trainingMinutes: 5, breakMinutes: 24, dailyMinutes: 480, saturdayMinutes: 255, officeMinutes: 15, clientAlertMinutes: 10, callbackMaxMonths: 1, resultAlertSeconds: 100, shortCallSeconds: 5 },
  },
  /** Importação da base de empresas (documento «Importação e reconciliação», decisões de 10 nov). */
  importBase: {
    schema: z.object({
      /** Ex-comerciais: as empresas delas entram sem carteira (Basecom). */
      formerSales: z.array(z.string().min(1)).max(50),
      /** Nome que significa «sem carteira» na coluna Comercial Responsável. */
      noOwnerName: z.string().min(1),
      trialSize: z.number().int().min(10).max(5000),
      operators: z.object({ list: z.array(z.string().min(1)).min(1).max(50), aliases: z.record(z.string(), z.string()) }),
      /** Coluna do Excel → campo do CRM (guardado na última importação). */
      mapping: z.record(z.string(), z.string()),
    }),
    defaults: {
      formerSales: ["Rute Pereira", "Ana Margarida Almeida", "Ana"],
      noOwnerName: "Basecom",
      trialSize: 500,
      operators: DEFAULT_OPERATORS,
      mapping: {} as Record<string, string>,
    },
  },
  /** Catálogos operacionais (Fase 02, tópico 2): resultados, tentativas, motivos, oportunidades e tarefas. */
  catalogs: {
    schema: z.object({
      outcomes: z.array(z.object({
        id: z.string().min(1), label: z.string().min(1).max(80), active: z.boolean(),
        group: z.enum(["refuse", "callback", "noanswer", "proposal", "sale", "other"]),
        effect: z.enum(["no_answer", "busy", "voicemail", "wrong_number", "decisor_absent", "call_later", "not_interested", "interested", "proposal_sent", "negotiating", "sale", "company_closed", "do_not_contact", "other_wallet"]),
      })).min(1),
      attempts: z.object({
        noAnswerRetryMinutes: z.number().int().min(1).max(1440), busyRetryMinutes: z.number().int().min(1).max(1440),
        maxAttemptsPerDay: z.number().int().min(1).max(20), maxAttemptsTotal: z.number().int().min(1).max(50), maxVoicemailsPerNumber: z.number().int().min(1).max(20),
      }),
      reasons: z.array(z.object({
        id: z.string().min(1), label: z.string().min(1).max(120), active: z.boolean(),
        effect: z.enum(["cooldown", "loyalty_end", "new_contract", "followup_task", "company_closed", "dissatisfied", "other"]),
        days: z.number().int().min(0).max(3650).optional(), months: z.number().int().min(1).max(60).optional(), monthsBefore: z.number().int().min(0).max(60).optional(), unknownMonths: z.number().int().min(0).max(60).optional(), contractMonths: z.number().int().min(1).max(120).optional(),
      })).min(1),
      opportunities: z.object({ warnDays: z.number().int().min(1).max(60), lateDays: z.number().int().min(1).max(90), lostReopenDays: z.number().int().min(0).max(3650), docsTaskDays: z.number().int().min(1).max(60).default(2), channels: z.array(z.string().min(1).max(40)).min(1).max(12).default(DEFAULT_PROPOSAL_CHANNELS) }),
      taskTypes: z.array(z.string().min(1).max(60)).min(1),
    }),
    defaults: { outcomes: DEFAULT_OUTCOMES, attempts: DEFAULT_ATTEMPT_RULES, reasons: DEFAULT_REASONS, opportunities: DEFAULT_OPPORTUNITY_RULES, taskTypes: DEFAULT_TASK_TYPES },
  },
  /** Mensagens rápidas (17 nov): modelos para WhatsApp, SMS e email. */
  /** Multiplicadores da Receita NOS (só gerência): valor em € do Pipeline do Administrador. */
  nosRevenue: {
    schema: z.object({ NN: z.number().min(0).max(50), XSell: z.number().min(0).max(50), FID: z.number().min(0).max(50), Upsell: z.number().min(0).max(50) }),
    defaults: DEFAULT_NOS_MULTIPLIERS,
  },
  messages: {
    schema: z.object({
      templates: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().trim().min(2).max(60), text: z.string().trim().min(5).max(1000), active: z.boolean() })).min(1),
      signature: z.string().max(600).default(DEFAULT_SIGNATURE),
    }),
    defaults: { templates: DEFAULT_MESSAGE_TEMPLATES, signature: DEFAULT_SIGNATURE },
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

export async function getSetting<K extends SettingKey>(db: Db, key: K): Promise<SettingValue<K>> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  const parsed = SETTINGS[key].schema.safeParse(row?.value);
  return (parsed.success ? parsed.data : SETTINGS[key].defaults) as SettingValue<K>;
}

export async function getAllSettings(db: Db) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(SETTINGS) as SettingKey[]) out[k] = await getSetting(db, k);
  return out;
}

export async function setSetting(db: Db, key: SettingKey, value: unknown, userId: string) {
  const v = SETTINGS[key].schema.parse(value);
  if (key === "catalogs") checkCatalogs(v as SettingValue<"catalogs">);
  await db.insert(settings).values({ key, value: v, updatedBy: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date(), updatedBy: userId } });
  await db.insert(auditLog).values({ userId, action: "configuracao_alterada", entity: "settings", entityId: key, details: JSON.stringify(v) });
  return v;
}

/**
 * Regras estruturais dos catálogos: o Administrador muda nomes, ativa/desativa e cria motivos,
 * mas não apaga resultados nem muda o que cada um faz; os identificadores não se repetem; os prazos são coerentes.
 */
export function checkCatalogs(v: SettingValue<"catalogs">) {
  const bad = (m: string): never => { throw new AuthError(400, m); };
  for (const d of DEFAULT_OUTCOMES) {
    const o = v.outcomes.find((x) => x.id === d.id);
    if (!o) bad(`O resultado «${d.label}» não pode ser apagado (pode ser desativado).`);
    if (o!.effect !== d.effect || o!.group !== d.group) bad(`O que o resultado «${d.label}» faz não pode ser mudado.`);
  }
  const ids = v.reasons.map((r) => r.id);
  if (new Set(ids).size !== ids.length) bad("Há motivos repetidos.");
  if (!v.reasons.some((r) => r.active)) bad("Tem de haver pelo menos um motivo ativo.");
  if (v.opportunities.warnDays >= v.opportunities.lateDays) bad("O alerta das oportunidades tem de vir antes do prazo de atrasada.");
}
