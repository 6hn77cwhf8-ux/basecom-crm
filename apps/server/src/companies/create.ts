import { eq } from "drizzle-orm";
import { cleanNif, isValidNif, normalizeCompanyName, normalizePhone, splitSalutation } from "@basecom/shared";
import type { Db } from "../db/client.js";
import { auditLog, companies, companyContacts, companyNotes } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";

export type NewCompanyInput = {
  nif: string; name: string; kind: "NN" | "NC" | "FC";
  phones?: string[]; email?: string | null; decisor?: string | null;
  address?: string | null; postalCode?: string | null; locality?: string | null; municipality?: string | null; district?: string | null;
  sector?: string | null; operator?: string | null; l2bMonthly?: number | null; loyaltyMonths?: number | null; loyaltyEnd?: string | null; note?: string | null;
};

/**
 * Criar uma empresa no CRM (20 nov): qualquer perfil; NN, NC ou FC; NIF válido e sem duplicados (se já existir,
 * devolve a existente). Fica sem carteira e sem campanha; entra nas campanhas quando o Administrador as atualizar.
 */
export async function createCompany(db: Db, by: PublicUser, input: NewCompanyInput) {
  const nif = cleanNif(input.nif);
  if (!isValidNif(nif)) throw new AuthError(400, "NIF inválido (9 algarismos, com dígito de controlo certo).");
  const name = input.name.trim();
  if (name.length < 2) throw new AuthError(400, "Indique o nome da empresa.");
  const existing = await db.query.companies.findFirst({ where: eq(companies.nif, nif) });
  if (existing) return { id: existing.id, existed: true };
  const phones = (input.phones ?? []).map((p) => p.trim()).filter(Boolean).map((p) => ({ raw: p, n: normalizePhone(p) }));
  const bad = phones.find((p) => !p.n);
  if (bad) throw new AuthError(400, `Telefone inválido: ${bad.raw}`);
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new AuthError(400, "Email inválido.");
  if (input.postalCode && !/^\d{4}-\d{3}$/.test(input.postalCode.trim())) throw new AuthError(400, "Código postal no formato 1234-567.");
  const dec = input.decisor?.trim() ? splitSalutation(input.decisor.trim()) : null;
  const t = (v?: string | null) => v?.trim() || null;
  const id = await db.transaction(async (tx) => {
    const [co] = await tx.insert(companies).values({
      nif, nifValid: true, name, nameKey: normalizeCompanyName(name),
      accountType: input.kind === "NN" ? "prospect" : "client", walletKind: input.kind === "FC" ? "FC" : "NC", walletKindConfirmed: input.kind !== "NN",
      address: t(input.address), postalCode: t(input.postalCode), locality: t(input.locality), municipality: t(input.municipality), district: t(input.district),
      sector: t(input.sector), operator: t(input.operator), l2bMonthly: input.l2bMonthly != null ? String(input.l2bMonthly) : null,
      loyaltyMonths: input.loyaltyMonths ?? null, loyaltyEnd: t(input.loyaltyEnd), portalStatus: input.kind === "NN" ? null : "CLIENTE",
      sources: "Criada no CRM", addressEditedAt: input.address || input.postalCode ? new Date() : null,
    }).returning({ id: companies.id });
    for (const [i, p] of phones.entries()) {
      await tx.insert(companyContacts).values({ companyId: co!.id, kind: "phone", value: p.n!.national, phoneType: p.n!.type, isPrimary: i === 0, personName: i === 0 ? dec?.name ?? null : null, salutation: i === 0 ? dec?.salutation ?? null : null });
    }
    if (t(input.email)) await tx.insert(companyContacts).values({ companyId: co!.id, kind: "email", value: input.email!.trim().toLowerCase(), isPrimary: true, personName: dec?.name ?? null, salutation: dec?.salutation ?? null });
    if (dec && !phones.length && !t(input.email)) await tx.insert(companyContacts).values({ companyId: co!.id, kind: "person", value: dec.name, personName: dec.name, salutation: dec.salutation, isPrimary: true });
    await tx.insert(companyNotes).values({ companyId: co!.id, kind: "note", userId: by.id, text: `Empresa criada no CRM por ${by.name} (${input.kind})${t(input.note) ? ` · ${t(input.note)}` : ""}` });
    await tx.insert(auditLog).values({ userId: by.id, action: "empresa_criada", entity: "company", entityId: co!.id, details: `${nif} · ${name} · ${input.kind}` });
    return co!.id;
  });
  return { id, existed: false };
}
