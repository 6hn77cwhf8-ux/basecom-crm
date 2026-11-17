import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, companyNotes } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";
import { getSetting } from "../settings.js";
import { queueSms } from "../phone/service.js";

export type Channel = "whatsapp" | "sms" | "email";
const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Email" };

/**
 * Mensagem rápida (17 nov): fica no histórico da empresa. No SMS, o telemóvel BASECOM emparelhado abre a app de mensagens
 * com o número e o texto; no WhatsApp e no email, o computador abre o programa (o comercial é sempre quem envia).
 */
export async function logMessage(db: Db, user: PublicUser, companyId: string, input: { channel: Channel; templateId?: string; to: string; text: string }) {
  const co = await db.query.companies.findFirst({ where: eq(companies.id, companyId), columns: { id: true } });
  if (!co) throw new AuthError(404, "Empresa não encontrada.");
  const text = input.text.trim();
  if (text.length < 2) throw new AuthError(400, "Escreva a mensagem.");
  let viaPhone = false;
  if (input.channel === "sms") {
    const number = input.to.replace(/\D/g, "").replace(/^351/, "");
    if (!/^9\d{8}$/.test(number)) throw new AuthError(400, "A SMS só vai para números móveis (9 algarismos começados por 9).");
    viaPhone = await queueSms(db, user.id, number, text);
    if (!viaPhone) throw new AuthError(409, "Telemóvel BASECOM sem ligação: abra a app no telemóvel e tente de novo.");
  }
  const tpl = input.templateId ? (await getSetting(db, "messages")).templates.find((t) => t.id === input.templateId) : undefined;
  await db.insert(companyNotes).values({ companyId, kind: "message", userId: user.id, text: `${CHANNEL_LABEL[input.channel]} · ${tpl?.label ?? "Mensagem"} · para ${input.to} · ${user.name}` });
  return { ok: true, viaPhone };
}
