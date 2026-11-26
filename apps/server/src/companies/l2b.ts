import { eq } from "drizzle-orm";
import { addMonthsUTC } from "@basecom/shared";
import type { Db } from "../db/client.js";
import { companies, companyNotes } from "../db/schema.js";
import { AuthError } from "../auth/service.js";

/** Informação do cliente deixada numa recusa ou num fecho (25 nov): mensalidade L2B, contrato 24/36 e meses que faltam. */
export type L2BInput = { monthly?: number; contractMonths?: number; monthsLeft?: number };

/** Etapas «depois de proposta»: a recusa ou a Perdida pedem a informação do cliente. */
export const AFTER_PROPOSAL = ["proposal", "negotiation", "documents"];

export function checkL2B(l: L2BInput | undefined, need: { contract?: boolean; left?: boolean }) {
  if (l?.monthly == null || !(l.monthly >= 0)) throw new AuthError(400, "Indique a mensalidade do cliente (L2B).");
  if (need.contract && ![24, 36].includes(l.contractMonths ?? 0)) throw new AuthError(400, "Indique a fidelização: 24 ou 36 meses.");
  if (need.left && (l.monthsLeft == null || l.monthsLeft < 0 || l.monthsLeft > 60)) throw new AuthError(400, "Indique os meses de permanência que faltam.");
  return l as Required<Pick<L2BInput, "monthly">> & L2BInput;
}

/**
 * Atualiza o L2B na ficha (mensalidade, meses que faltam e data de fim). A data de fim faz os meses descontarem
 * sozinhos; fica marcado como editado no CRM (as importações não o apagam).
 */
export async function applyL2B(db: Db, companyId: string, userId: string, l: L2BInput, monthsLeft: number | null, why: string) {
  const now = new Date();
  const end = monthsLeft != null ? addMonthsUTC(now, monthsLeft).toISOString().slice(0, 10) : undefined;
  await db.update(companies).set({
    l2bMonthly: String(Math.round(l.monthly! * 100) / 100), ...(monthsLeft != null ? { loyaltyMonths: monthsLeft, loyaltyEnd: end } : {}),
    l2bEditedAt: now, updatedAt: now,
  }).where(eq(companies.id, companyId));
  const eur = l.monthly!.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  await db.insert(companyNotes).values({ companyId, kind: "note", userId, at: now,
    text: `L2B atualizado (${why}): ${eur} €/mês${monthsLeft != null ? ` · faltam ${monthsLeft} meses (fim ${end!.split("-").reverse().join("/")})` : ""}${l.contractMonths ? ` · fidelização de ${l.contractMonths} meses` : ""}` });
}
