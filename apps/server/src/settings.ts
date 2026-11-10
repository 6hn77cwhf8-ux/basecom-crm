import { eq } from "drizzle-orm";
import { z } from "zod";
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
