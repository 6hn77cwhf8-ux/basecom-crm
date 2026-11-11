import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { cycleForDate, cycleFromIndex } from "@basecom/shared";
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

/** Telefone ou email «Incorreto»: nunca é reativado por uma importação. */
export async function setContactStatus(db: Db, by: PublicUser, contactId: string, status: "valid" | "incorrect") {
  const ct = await db.query.companyContacts.findFirst({ where: eq(companyContacts.id, contactId) });
  if (!ct) throw new AuthError(404, "Contacto não encontrado.");
  const co = await loadCompany(db, ct.companyId);
  // Empresas sem carteira: o comercial poderá editar quando estiverem numa campanha sua (Fase 3).
  if (!canEdit(by, co.ownerId)) throw new AuthError(403, "Só o responsável da carteira ou o Administrador alteram os contactos desta empresa.");
  if (ct.status === status) return;
  await db.update(companyContacts).set({ status }).where(eq(companyContacts.id, contactId));
  await db.insert(companyNotes).values({ companyId: co.id, kind: "note", text: `Contacto ${ct.value} marcado como ${status === "incorrect" ? "Incorreto" : "Válido"}`, userId: by.id });
  await db.insert(auditLog).values({ userId: by.id, action: "contacto_estado_alterado", entity: "company", entityId: co.id, details: `${ct.value} → ${status}` });
}

/** Regra fixa: consultas a empresas de outra carteira ficam em auditoria. */
export async function auditForeignView(db: Db, by: PublicUser, companyId: string, ownerId: string | null) {
  if (by.role === "admin" || !ownerId || ownerId === by.id) return;
  await db.insert(auditLog).values({ userId: by.id, action: "consulta_outra_carteira", entity: "company", entityId: companyId });
}
