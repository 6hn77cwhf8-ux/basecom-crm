import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { auditLog, companies, companyNotes, walletChanges } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";
import { reassignCompany } from "../campaigns/service.js";

async function load(db: Db, id: string) {
  const co = await db.query.companies.findFirst({ where: eq(companies.id, id) });
  if (!co) throw new AuthError(404, "Empresa não encontrada.");
  return co;
}

/**
 * Passar a ex-cliente (18 nov): qualquer perfil, com justificação. Deixa de ser cliente NOS, perde a carteira (NC/FC),
 * sai das campanhas de clientes atuais e entra nas de ex-clientes. A importação seguinte não volta a pôr «Cliente».
 */
export async function markFormerClient(db: Db, by: PublicUser, companyId: string, reason: string) {
  const why = reason.trim();
  if (why.length < 3) throw new AuthError(400, "Indique porque passa a ex-cliente.");
  const co = await load(db, companyId);
  if (co.accountType !== "client" && co.portalStatus?.toUpperCase() === "EX-CLIENTE") throw new AuthError(409, "Esta empresa já é ex-cliente.");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(companies).set({ accountType: "prospect", portalStatus: "EX-CLIENTE", ownerId: null, walletKind: "NC", walletKindConfirmed: false, statusEditedAt: now, updatedAt: now }).where(eq(companies.id, co.id));
    if (co.ownerId) await tx.insert(walletChanges).values({ companyId: co.id, fromOwnerId: co.ownerId, toOwnerId: null, kind: "release", effectiveFrom: now.toISOString().slice(0, 10), status: "applied", reason: `Passou a ex-cliente: ${why}`, createdBy: by.id, appliedAt: now });
    await tx.insert(companyNotes).values({ companyId: co.id, kind: "note", userId: by.id, text: `Passou a ex-cliente (${co.accountType === "client" ? `era cliente${co.ownerId ? ` ${co.walletKind}` : ""}` : "estado anterior: " + (co.portalStatus ?? "—")}) · ${why}` });
    await tx.insert(auditLog).values({ userId: by.id, action: "ex_cliente", entity: "company", entityId: co.id, details: why });
  });
  return reassignCompany(db, co.id);
}

/**
 * Corrigir o L2B (mensalidade NOS e meses de permanência) — 18 nov. Fica no histórico (antigo → novo), a empresa troca
 * logo de campanha e as importações seguintes não apagam a correção.
 */
export async function editL2B(db: Db, by: PublicUser, companyId: string, input: { l2bMonthly?: number | null; loyaltyMonths?: number | null }) {
  const co = await load(db, companyId);
  const changes: string[] = [];
  const patch: Partial<typeof companies.$inferInsert> = {};
  const eur = (v: number | string | null) => (v == null ? "—" : `${Number(v).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
  if (input.l2bMonthly !== undefined && Number(co.l2bMonthly ?? NaN) !== Number(input.l2bMonthly ?? NaN)) {
    if (input.l2bMonthly != null && (input.l2bMonthly < 0 || input.l2bMonthly > 100_000)) throw new AuthError(400, "Mensalidade inválida.");
    patch.l2bMonthly = input.l2bMonthly == null ? null : String(input.l2bMonthly);
    changes.push(`L2B: ${eur(co.l2bMonthly)} → ${eur(input.l2bMonthly)}`);
  }
  if (input.loyaltyMonths !== undefined && (co.loyaltyMonths ?? null) !== (input.loyaltyMonths ?? null)) {
    if (input.loyaltyMonths != null && (input.loyaltyMonths < 0 || input.loyaltyMonths > 120)) throw new AuthError(400, "Meses de permanência inválidos.");
    patch.loyaltyMonths = input.loyaltyMonths;
    changes.push(`Meses de permanência: ${co.loyaltyMonths ?? "—"} → ${input.loyaltyMonths ?? "—"}`);
  }
  if (!changes.length) return { left: [], joined: [] };
  await db.update(companies).set({ ...patch, l2bEditedAt: new Date(), updatedAt: new Date() }).where(eq(companies.id, co.id));
  await db.insert(companyNotes).values({ companyId: co.id, kind: "note", userId: by.id, text: `L2B corrigido no CRM · ${changes.join(" · ")}` });
  await db.insert(auditLog).values({ userId: by.id, action: "l2b_alterado", entity: "company", entityId: co.id, details: changes.join(" · ") });
  return reassignCompany(db, co.id);
}

/** Insatisfeito NOS: só o Administrador retira antes do prazo. */
export async function liftDissatisfied(db: Db, by: PublicUser, companyId: string) {
  if (by.role !== "admin") throw new AuthError(403, "Só o Administrador retira o «Insatisfeito NOS» antes do prazo.");
  const co = await load(db, companyId);
  if (!co.dissatisfiedUntil) return { left: [], joined: [] };
  await db.update(companies).set({ dissatisfiedUntil: null, campaignEligibleFrom: null, updatedAt: new Date() }).where(eq(companies.id, co.id));
  await db.insert(companyNotes).values({ companyId: co.id, kind: "note", userId: by.id, text: `«Insatisfeito NOS» retirado antes do prazo (era até ${co.dissatisfiedUntil}).` });
  await db.insert(auditLog).values({ userId: by.id, action: "insatisfeito_retirado", entity: "company", entityId: co.id, details: co.dissatisfiedUntil });
  return reassignCompany(db, co.id);
}
