import { and, asc, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, companyContacts, companyNotes, users } from "../db/schema.js";
import { AuthError } from "../auth/service.js";
import { normalizeCompanyName } from "@basecom/shared";

/**
 * Empresas: qualquer utilizador encontra qualquer empresa e vê o histórico (maquetas, ecrã Empresas);
 * as de outra carteira nunca entram nas suas tarefas nem campanhas.
 */

export type CompanyFilters = {
  q?: string; accountType?: "client" | "prospect"; owner?: string; wallet?: "NC" | "FC";
  status?: "dnc" | "review" | "nif"; municipality?: string; district?: string; sector?: string; offset?: number; limit?: number;
};

const ACCENTED = "áàâãäéèêëíìîïóòôõöúùûüç";
const PLAIN = "aaaaaeeeeiiiiooooouuuuc";

/**
 * Pesquisa por NIF, telefone, nome da empresa, decisor ou email.
 * Só algarismos → NIF e telefones. Texto → nome sem acentos (já guardado na importação), decisor e email.
 */
function searchCond(q: string): SQL | undefined {
  const t = q.trim();
  if (!t) return undefined;
  const digits = t.replace(/\D/g, "");
  if (/^[\d\s+.-]+$/.test(t)) {
    if (digits.length < 3) return sql`false`;
    return sql`(${companies.nif} like ${digits + "%"} or ${companies.id} in (select cc.company_id from ${companyContacts} cc where cc.value like ${"%" + digits + "%"}))`;
  }
  const plain = `%${t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")}%`;
  const key = normalizeCompanyName(t);
  const parts: SQL[] = [];
  if (key) parts.push(sql`${companies.nameKey} like ${"%" + key + "%"}`);
  parts.push(sql`${companies.name} ilike ${"%" + t + "%"}`);
  if (t.length >= 3) {
    parts.push(sql`${companies.id} in (select cc.company_id from ${companyContacts} cc where cc.person_name is not null and translate(lower(cc.person_name), ${ACCENTED}, ${PLAIN}) like ${plain})`);
    parts.push(sql`${companies.id} in (select cc.company_id from ${companyContacts} cc where cc.kind = 'email' and cc.value like ${"%" + t.toLowerCase() + "%"})`);
  }
  return sql`(${sql.join(parts, sql` or `)})`;
}

function where(f: CompanyFilters) {
  const c: (SQL | undefined)[] = [searchCond(f.q ?? "")];
  if (f.accountType) c.push(eq(companies.accountType, f.accountType));
  if (f.owner === "none") c.push(isNull(companies.ownerId));
  else if (f.owner === "any") c.push(isNotNull(companies.ownerId));
  else if (f.owner) c.push(eq(companies.ownerId, f.owner));
  if (f.wallet) c.push(and(isNotNull(companies.ownerId), eq(companies.walletKind, f.wallet)));
  if (f.status === "dnc") c.push(eq(companies.doNotContact, true));
  if (f.status === "review") c.push(isNotNull(companies.needsReview));
  if (f.status === "nif") c.push(eq(companies.nifValid, false));
  if (f.municipality) c.push(eq(companies.municipality, f.municipality));
  if (f.district) c.push(eq(companies.district, f.district));
  if (f.sector) c.push(eq(companies.sector, f.sector));
  return and(...c.filter(Boolean));
}

export async function listCompanies(db: Db, f: CompanyFilters) {
  const w = where(f);
  const [{ total }] = (await db.select({ total: sql<number>`count(*)::int` }).from(companies).where(w)) as [{ total: number }];
  const rows = await db.select({
    id: companies.id, nif: companies.nif, name: companies.name, accountType: companies.accountType,
    municipality: companies.municipality, locality: companies.locality, district: companies.district, sector: companies.sector,
    ownerId: companies.ownerId, owner: users.name,
    walletKind: companies.walletKind, doNotContact: companies.doNotContact, needsReview: companies.needsReview,
    nifValid: companies.nifValid, operator: companies.operator, loyaltyEnd: companies.loyaltyEnd,
  }).from(companies).leftJoin(users, eq(users.id, companies.ownerId)).where(w)
    .orderBy(asc(companies.name)).offset(f.offset ?? 0).limit(Math.min(f.limit ?? 50, 200));
  return { total, rows };
}

/** Números do topo do ecrã Empresas (sem filtros). */
export async function companyKpis(db: Db) {
  const [k] = await db.select({
    total: sql<number>`count(*)::int`,
    noOwner: sql<number>`count(*) filter (where ${companies.ownerId} is null)::int`,
    withOwner: sql<number>`count(*) filter (where ${companies.ownerId} is not null)::int`,
    nc: sql<number>`count(*) filter (where ${companies.ownerId} is not null and ${companies.walletKind} = 'NC')::int`,
    fc: sql<number>`count(*) filter (where ${companies.ownerId} is not null and ${companies.walletKind} = 'FC')::int`,
    clients: sql<number>`count(*) filter (where ${companies.accountType} = 'client')::int`,
    dnc: sql<number>`count(*) filter (where ${companies.doNotContact})::int`,
    review: sql<number>`count(*) filter (where ${companies.needsReview} is not null or not ${companies.nifValid})::int`,
  }).from(companies);
  return k!;
}

/** Valores para os filtros (concelhos, distritos e setores existentes). */
export async function filterOptions(db: Db) {
  const list = async (col: "municipality" | "district" | "sector" | "operator" | "product" | "technology" | "portalStatus" | "size") =>
    (await db.selectDistinct({ v: companies[col] }).from(companies).where(isNotNull(companies[col])).orderBy(companies[col])).map((r) => r.v!);
  return {
    municipalities: await list("municipality"), districts: await list("district"), sectors: await list("sector"),
    operators: await list("operator"), products: await list("product"), technologies: await list("technology"),
    portalStatuses: await list("portalStatus"), sizes: await list("size"),
  };
}

/** Pesquisa global da barra lateral: as 8 melhores correspondências. */
export async function quickSearch(db: Db, q: string) {
  if (q.trim().length < 2) return [];
  const rows = await db.select({
    id: companies.id, nif: companies.nif, name: companies.name, municipality: companies.municipality, owner: users.name,
    accountType: companies.accountType,
  }).from(companies).leftJoin(users, eq(users.id, companies.ownerId)).where(searchCond(q))
    .orderBy(sql`case when ${companies.nif} = ${q.replace(/\D/g, "")} then 0 when ${companies.name} ilike ${q.trim() + "%"} then 1 else 2 end`, asc(companies.name)).limit(8);
  return rows;
}

export async function getCompany(db: Db, id: string) {
  const [c] = await db.select({ company: companies, owner: users.name }).from(companies).leftJoin(users, eq(users.id, companies.ownerId)).where(eq(companies.id, id));
  if (!c) throw new AuthError(404, "Empresa não encontrada.");
  const contacts = await db.select().from(companyContacts).where(eq(companyContacts.companyId, id)).orderBy(desc(companyContacts.isPrimary), asc(companyContacts.kind), asc(companyContacts.createdAt));
  const notes = await db.select({ id: companyNotes.id, kind: companyNotes.kind, text: companyNotes.text, at: companyNotes.at, user: users.name, batchId: companyNotes.batchId })
    .from(companyNotes).leftJoin(users, eq(users.id, companyNotes.userId)).where(eq(companyNotes.companyId, id)).orderBy(desc(companyNotes.at)).limit(300);
  const { batchId: _b, nameKey: _k, ...company } = c.company;
  return { company: { ...company, owner: c.owner }, contacts, notes };
}
