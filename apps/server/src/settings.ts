import { eq } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_ATTEMPT_RULES, DEFAULT_OPERATORS, DEFAULT_OPPORTUNITY_RULES, DEFAULT_OUTCOMES, DEFAULT_REASONS, DEFAULT_TASK_TYPES } from "@basecom/shared";
import type { Db } from "./db/client.js";
import { auditLog, settings } from "./db/schema.js";

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
    }),
    defaults: { resultSeconds: 15, nextCallSeconds: 10, campaignSwitchMinutes: 2, trainingMinutes: 5, breakMinutes: 24 },
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
        effect: z.enum(["cooldown", "loyalty_end", "new_contract", "followup_task", "company_closed", "other"]),
        days: z.number().int().min(0).max(3650).optional(), monthsBefore: z.number().int().min(0).max(60).optional(), contractMonths: z.number().int().min(1).max(120).optional(),
      })).min(1),
      opportunities: z.object({ warnDays: z.number().int().min(1).max(60), lateDays: z.number().int().min(1).max(90), lostReopenDays: z.number().int().min(0).max(3650) }),
      taskTypes: z.array(z.string().min(1).max(60)).min(1),
    }),
    defaults: { outcomes: DEFAULT_OUTCOMES, attempts: DEFAULT_ATTEMPT_RULES, reasons: DEFAULT_REASONS, opportunities: DEFAULT_OPPORTUNITY_RULES, taskTypes: DEFAULT_TASK_TYPES },
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
  await db.insert(settings).values({ key, value: v, updatedBy: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date(), updatedBy: userId } });
  await db.insert(auditLog).values({ userId, action: "configuracao_alterada", entity: "settings", entityId: key, details: JSON.stringify(v) });
  return v;
}
