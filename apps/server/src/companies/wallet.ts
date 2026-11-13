import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { cycleForDate, cycleFromIndex, normalizePhone } from "@basecom/shared";
import type { Db } from "../db/client.js";
import { auditLog, companies, companyContacts, companyNotes, users, walletChanges } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";

/**
 * Carteiras (fluxo 5.2 e Matriz de permissões):
 * - só o Administrador transfere ou devolve a «sem carteira», sempre com justificação;
 * - a transferência vale a partir do início de um ciclo (o atual ou o seguinte);
 * - o histórico nunca se apaga e tudo fica em auditoria.
 */

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Início do ciclo atual ou do seguinte (AAAA-MM-DD). */
export function cycleStart(when: "current" | "next", now = new Date()) {
  const cur = cycleForDate(now);
  if (when === "current") return { date: day(cur.start), label: cur.label };
  const idx = Math.round((cur.start.getTime() - Date.UTC(2026, 0, 5)) / (28 * 86_400_000)) + 1;
  const next = cycleFromIndex(idx);
  return { date: day(next.start), label: next.label };
}

export async function scheduleTransfer(db: Db, by: PublicUser, input: { companyIds: string[]; toOwnerId: string | null; when: "current" | "next"; reason: string }) {
  if (by.role !== "admin") throw new AuthError(403, "Só o Administrador transfere carteira.");
  const reason = input.reason.trim();
  if (reason.length < 5) throw new AuthError(400, "Escreva a justificação da transferência.");
  let ownerName = "sem carteira";
  if (input.toOwnerId) {
    const u = await db.query.users.findFirst({ where: eq(users.id, input.toOwnerId) });
    if (!u || !u.active || u.role === "admin") throw new AuthError(400, "Escolha um comercial ou Chefe de Equipa ativo.");
    ownerName = u.name;
  }
  const rows = await db.select({ id: companies.id, ownerId: companies.ownerId, name: companies.name }).from(companies).where(inArray(companies.id, input.companyIds));
  if (rows.length !== input.companyIds.length) throw new AuthError(404, "Empresa não encontrada.");
  const { date, label } = cycleStart(input.when);
  const kind = input.toOwnerId ? "transfer" : "release";
  await db.transaction(async (tx) => {
    // Uma empresa só tem uma alteração agendada de cada vez: a nova substitui a anterior.
    await tx.update(walletChanges).set({ status: "cancelled" }).where(and(inArray(walletChanges.companyId, input.companyIds), eq(walletChanges.status, "scheduled")));
    await tx.insert(walletChanges).values(rows.map((r) => ({
      companyId: r.id, fromOwnerId: r.ownerId, toOwnerId: input.toOwnerId, kind, effectiveFrom: date, status: "scheduled", reason, createdBy: by.id,
    })));
    await tx.insert(auditLog).values({
      userId: by.id, action: kind === "transfer" ? "carteira_transferencia_agendada" : "carteira_devolucao_agendada", entity: "company",
      entityId: rows.length === 1 ? rows[0]!.id : null, details: `${rows.length} empresa(s) → ${ownerName} a partir de ${label} (${date}). Justificação: ${reason}`,
    });
  });
  const applied = await applyDueWalletChanges(db);
  return { scheduled: rows.length, effectiveFrom: date, cycle: label, applied };
}

/** Aplica as transferências cuja data já chegou (corre no arranque e de 10 em 10 minutos). */
export async function applyDueWalletChanges(db: Db, now = new Date()) {
  const due = await db.select().from(walletChanges).where(and(eq(walletChanges.status, "scheduled"), lte(walletChanges.effectiveFrom, day(now))));
  if (!due.length) return 0;
  await db.transaction(async (tx) => {
    for (const ch of due) {
      await tx.update(companies).set({ ownerId: ch.toOwnerId, updatedAt: new Date() }).where(eq(companies.id, ch.companyId));
      await tx.update(walletChanges).set({ status: "applied", appliedAt: new Date() }).where(eq(walletChanges.id, ch.id));
      const to = ch.toOwnerId ? (await tx.query.users.findFirst({ where: eq(users.id, ch.toOwnerId) }))?.name : null;
      await tx.insert(companyNotes).values({ companyId: ch.companyId, kind: "wallet", text: ch.toOwnerId ? `Carteira transferida para ${to}. Justificação: ${ch.reason}` : `Empresa devolvida a «sem carteira». Justificação: ${ch.reason}`, userId: ch.createdBy });
    }
  });
  return due.length;
}

export async function listScheduled(db: Db) {
  return db.select({
    id: walletChanges.id, companyId: walletChanges.companyId, company: companies.name, nif: companies.nif, kind: walletChanges.kind,
    effectiveFrom: walletChanges.effectiveFrom, reason: walletChanges.reason, toOwnerId: walletChanges.toOwnerId, toOwner: users.name, createdAt: walletChanges.createdAt,
  }).from(walletChanges).innerJoin(companies, eq(companies.id, walletChanges.companyId)).leftJoin(users, eq(users.id, walletChanges.toOwnerId))
    .where(eq(walletChanges.status, "scheduled")).orderBy(walletChanges.effectiveFrom, companies.name).limit(1000);
}

export async function cancelScheduled(db: Db, by: PublicUser, id: string) {
  const ch = await db.query.walletChanges.findFirst({ where: eq(walletChanges.id, id) });
  if (!ch || ch.status !== "scheduled") throw new AuthError(404, "Transferência agendada não encontrada.");
  await db.update(walletChanges).set({ status: "cancelled" }).where(eq(walletChanges.id, id));
  await db.insert(auditLog).values({ userId: by.id, action: "carteira_transferencia_cancelada", entity: "company", entityId: ch.companyId, details: ch.reason });
}

export async function walletHistory(db: Db, companyId: string) {
  return db.select({ id: walletChanges.id, kind: walletChanges.kind, status: walletChanges.status, effectiveFrom: walletChanges.effectiveFrom, reason: walletChanges.reason, toOwner: users.name, createdAt: walletChanges.createdAt })
    .from(walletChanges).leftJoin(users, eq(users.id, walletChanges.toOwnerId)).where(eq(walletChanges.companyId, companyId)).orderBy(desc(walletChanges.createdAt));
}

async function loadCompany(db: Db, id: string) {
  const co = await db.query.companies.findFirst({ where: eq(companies.id, id) });
  if (!co) throw new AuthError(404, "Empresa não encontrada.");
  return co;
}

/** Pode editar a ficha: Administrador (todas) ou o responsável da carteira. */
function canEdit(by: PublicUser, ownerId: string | null) {
  return by.role === "admin" || (ownerId !== null && ownerId === by.id);
}
/** Contactos: também quem trabalha empresas sem carteira (nas campanhas). */
function canEditContacts(by: PublicUser, ownerId: string | null) {
  return canEdit(by, ownerId) || ownerId === null;
}

/** NC/FC só por alteração manual, com justificação (FC conta 50 % em tudo). */
export async function setWalletKind(db: Db, by: PublicUser, companyId: string, kind: "NC" | "FC", reason: string) {
  const co = await loadCompany(db, companyId);
  if (!co.ownerId) throw new AuthError(400, "A empresa não está em nenhuma carteira.");
  if (!canEdit(by, co.ownerId)) throw new AuthError(403, "Só o responsável da carteira ou o Administrador alteram NC/FC.");
  if (reason.trim().length < 5) throw new AuthError(400, "Escreva a justificação.");
  if (co.walletKind === kind) return;
  await db.update(companies).set({ walletKind: kind, updatedAt: new Date() }).where(eq(companies.id, companyId));
  await db.insert(companyNotes).values({ companyId, kind: "wallet", text: `Carteira alterada de ${co.walletKind} para ${kind}. Justificação: ${reason.trim()}`, userId: by.id });
  await db.insert(auditLog).values({ userId: by.id, action: "carteira_nc_fc_alterada", entity: "company", entityId: companyId, details: `${co.walletKind} → ${kind}: ${reason.trim()}` });
}

/**
 * Clientes NOS sem carteira ainda não identificados como NC ou FC: o comercial tem de identificar (Teste 1, ponto 8).
 * Qualquer perfil identifica uma vez; depois, só por alteração manual com justificação.
 */
export async function identifyWalletKind(db: Db, by: PublicUser, companyId: string, kind: "NC" | "FC") {
  const co = await loadCompany(db, companyId);
  if (co.ownerId || co.walletKindConfirmed) throw new AuthError(409, "Esta empresa já tem NC/FC identificado.");
  await db.update(companies).set({ walletKind: kind, walletKindConfirmed: true, updatedAt: new Date() }).where(eq(companies.id, companyId));
  await db.insert(companyNotes).values({ companyId, kind: "wallet", text: `Identificada como ${kind}.`, userId: by.id });
  await db.insert(auditLog).values({ userId: by.id, action: "carteira_nc_fc_identificada", entity: "company", entityId: companyId, details: kind });
}

/** «Não contactar» (oposição RGPD): qualquer perfil marca; só o Administrador retira. */
export async function setDoNotContact(db: Db, by: PublicUser, companyId: string, value: boolean, reason: string) {
  const co = await loadCompany(db, companyId);
  if (!value && by.role !== "admin") throw new AuthError(403, "Só o Administrador retira a marca «Não contactar».");
  if (reason.trim().length < 3) throw new AuthError(400, "Indique o motivo.");
  if (co.doNotContact === value) return;
  await db.update(companies).set({ doNotContact: value, updatedAt: new Date() }).where(eq(companies.id, companyId));
  await db.insert(companyNotes).values({ companyId, kind: "note", text: value ? `Marcada «Não contactar». Motivo: ${reason.trim()}` : `Retirada a marca «Não contactar». Motivo: ${reason.trim()}`, userId: by.id });
  await db.insert(auditLog).values({ userId: by.id, action: value ? "nao_contactar_marcado" : "nao_contactar_retirado", entity: "company", entityId: companyId, details: reason.trim() });
}

/**
 * Telefone ou email «Incorreto»: nunca é reativado por uma importação.
 * Se era o principal, o seguinte válido do mesmo tipo passa a principal (sai logo do contacto principal).
 */
export async function setContactStatus(db: Db, by: PublicUser, contactId: string, status: "valid" | "incorrect") {
  const ct = await db.query.companyContacts.findFirst({ where: eq(companyContacts.id, contactId) });
  if (!ct) throw new AuthError(404, "Contacto não encontrado.");
  const co = await loadCompany(db, ct.companyId);
  if (!canEditContacts(by, co.ownerId)) throw new AuthError(403, "Só o responsável da carteira ou o Administrador alteram os contactos desta empresa.");
  if (ct.status === status) return;
  await db.transaction(async (tx) => {
    await tx.update(companyContacts).set({ status, ...(status === "incorrect" ? { isPrimary: false } : {}) }).where(eq(companyContacts.id, contactId));
    if (status === "incorrect" && ct.isPrimary) {
      const [next] = await tx.select({ id: companyContacts.id }).from(companyContacts)
        .where(and(eq(companyContacts.companyId, co.id), eq(companyContacts.kind, ct.kind), eq(companyContacts.status, "valid"))).orderBy(companyContacts.createdAt).limit(1);
      if (next) await tx.update(companyContacts).set({ isPrimary: true, personName: sql`coalesce(${companyContacts.personName}, ${ct.personName})`, salutation: sql`coalesce(${companyContacts.salutation}, ${ct.salutation})` }).where(eq(companyContacts.id, next.id));
    }
    await tx.insert(companyNotes).values({ companyId: co.id, kind: "note", text: `Contacto ${ct.value} marcado como ${status === "incorrect" ? "Incorreto" : "Válido"}`, userId: by.id });
    await lockContacts(tx as unknown as Db, co.id);
    await tx.insert(auditLog).values({ userId: by.id, action: "contacto_estado_alterado", entity: "company", entityId: co.id, details: `${ct.value} → ${status}` });
  });
}

/** Acrescentar um telefone ou email à empresa (com o nome da pessoa, opcional). */
export async function addContact(db: Db, by: PublicUser, companyId: string, input: { kind: "phone" | "email"; value: string; personName?: string; salutation?: string; primary?: boolean }) {
  const co = await loadCompany(db, companyId);
  if (!canEditContacts(by, co.ownerId)) throw new AuthError(403, "Só o responsável da carteira ou o Administrador alteram os contactos desta empresa.");
  let value = input.value.trim();
  let phoneType: string | null = null;
  if (input.kind === "phone") {
    const p = normalizePhone(value);
    if (!p) throw new AuthError(400, "Telefone inválido: use 9 algarismos (ex.: 912 345 678).");
    value = p.national; phoneType = p.type;
  } else {
    value = value.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new AuthError(400, "Email inválido.");
  }
  const existing = await db.select().from(companyContacts).where(and(eq(companyContacts.companyId, co.id), eq(companyContacts.kind, input.kind)));
  const dup = existing.find((x) => x.value === value);
  if (dup?.status === "valid") throw new AuthError(409, "Este contacto já existe na ficha.");
  if (dup) throw new AuthError(409, "Este contacto está marcado como incorreto. Pode voltar a marcá-lo como válido.");
  const primary = input.primary || !existing.some((x) => x.isPrimary && x.status === "valid");
  return db.transaction(async (tx) => {
    if (primary) await tx.update(companyContacts).set({ isPrimary: false }).where(and(eq(companyContacts.companyId, co.id), eq(companyContacts.kind, input.kind)));
    const [row] = await tx.insert(companyContacts).values({
      companyId: co.id, kind: input.kind, value, phoneType, personName: input.personName?.trim() || null, salutation: input.salutation?.trim() || null, isPrimary: primary,
    }).returning();
    await tx.insert(companyNotes).values({ companyId: co.id, kind: "note", text: `Contacto acrescentado: ${value}${input.personName?.trim() ? ` (${input.personName.trim()})` : ""}`, userId: by.id });
    await tx.insert(auditLog).values({ userId: by.id, action: "contacto_acrescentado", entity: "company", entityId: co.id, details: value });
    await lockContacts(tx as unknown as Db, co.id);
    return row!;
  });
}

/** Regra fixa: consultas a empresas de outra carteira ficam em auditoria. */
export async function auditForeignView(db: Db, by: PublicUser, companyId: string, ownerId: string | null) {
  if (by.role === "admin" || !ownerId || ownerId === by.id) return;
  await db.insert(auditLog).values({ userId: by.id, action: "consulta_outra_carteira", entity: "company", entityId: companyId });
}

/**
 * Apagar empresas (leads): só o Administrador, com justificação e código 2FA (pedido no Teste 2).
 * Apaga também contactos, histórico, chamadas, tarefas e oportunidades dessas empresas. Fica na auditoria com NIF e nome.
 * Uma importação futura com o mesmo NIF volta a criar a empresa como nova.
 */
export async function deleteCompanies(db: Db, by: PublicUser, ids: string[], reason: string) {
  if (by.role !== "admin") throw new AuthError(403, "Só o Administrador apaga empresas.");
  if (reason.trim().length < 5) throw new AuthError(400, "Escreva a justificação.");
  const rows = await db.select({ id: companies.id, nif: companies.nif, name: companies.name }).from(companies).where(inArray(companies.id, ids));
  if (!rows.length) throw new AuthError(404, "Nenhuma empresa encontrada.");
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 1000) await tx.delete(companies).where(inArray(companies.id, rows.slice(i, i + 1000).map((r) => r.id)));
    const list = rows.slice(0, 200).map((r) => `${r.nif} ${r.name}`).join("; ");
    await tx.insert(auditLog).values({ userId: by.id, action: "empresas_apagadas", entity: "company", details: `${rows.length} empresa(s). Justificação: ${reason.trim()}. ${list}${rows.length > 200 ? " …" : ""}` });
  });
  return { deleted: rows.length };
}

/** A partir daqui o CRM manda nos contactos e nomes desta empresa: a importação deixa de os alterar. */
export async function lockContacts(db: Db, companyId: string) {
  await db.update(companies).set({ contactsLockedAt: sql`coalesce(${companies.contactsLockedAt}, now())` }).where(eq(companies.id, companyId));
}

const ADDRESS_FIELDS = ["address", "postalCode", "locality", "municipality", "district"] as const;
const ADDRESS_LABEL: Record<(typeof ADDRESS_FIELDS)[number], string> = { address: "Morada", postalCode: "Código postal", locality: "Localidade", municipality: "Concelho", district: "Distrito" };

/** Editar a morada na ficha: fica no histórico (antes → depois) e a importação deixa de a alterar. */
export async function editAddress(db: Db, by: PublicUser, companyId: string, input: Partial<Record<(typeof ADDRESS_FIELDS)[number], string | null>>) {
  const co = await loadCompany(db, companyId);
  if (!canEditContacts(by, co.ownerId)) throw new AuthError(403, "Só o responsável da carteira ou o Administrador alteram esta empresa.");
  const patch: Record<string, string | null> = {};
  const changes: string[] = [];
  for (const k of ADDRESS_FIELDS) {
    if (!(k in input)) continue;
    const v = input[k]?.trim() || null;
    const before = (co as Record<string, unknown>)[k] as string | null;
    if (v !== before) { patch[k] = v; changes.push(`${ADDRESS_LABEL[k]}: ${before ?? "—"} → ${v ?? "—"}`); }
  }
  if (input.postalCode && !/^\d{4}-\d{3}$/.test(input.postalCode.trim())) throw new AuthError(400, "Código postal no formato 1234-567.");
  if (!changes.length) return;
  await db.update(companies).set({ ...patch, addressEditedAt: new Date(), updatedAt: new Date() }).where(eq(companies.id, co.id));
  await db.insert(companyNotes).values({ companyId: co.id, kind: "note", userId: by.id, text: `Morada alterada no CRM · ${changes.join(" · ")}` });
  await db.insert(auditLog).values({ userId: by.id, action: "morada_alterada", entity: "company", entityId: co.id, details: changes.join(" · ") });
}

/** Corrigir o nome (e o tratamento) de um contacto. */
export async function editContact(db: Db, by: PublicUser, contactId: string, input: { personName?: string | null; salutation?: string | null }) {
  const ct = await db.query.companyContacts.findFirst({ where: eq(companyContacts.id, contactId) });
  if (!ct) throw new AuthError(404, "Contacto não encontrado.");
  const co = await loadCompany(db, ct.companyId);
  if (!canEditContacts(by, co.ownerId)) throw new AuthError(403, "Só o responsável da carteira ou o Administrador alteram os contactos desta empresa.");
  const name = input.personName === undefined ? ct.personName : input.personName?.trim() || null;
  const sal = input.salutation === undefined ? ct.salutation : input.salutation?.trim() || null;
  await db.update(companyContacts).set({ personName: name, salutation: sal, ...(ct.kind === "person" && name ? { value: name } : {}) }).where(eq(companyContacts.id, ct.id));
  await db.insert(companyNotes).values({ companyId: co.id, kind: "note", userId: by.id, text: `Nome do contacto ${ct.kind === "person" ? "" : ct.value + " "}alterado: ${[ct.salutation, ct.personName].filter(Boolean).join(" ") || "—"} → ${[sal, name].filter(Boolean).join(" ") || "—"}` });
  await lockContacts(db, co.id);
}
