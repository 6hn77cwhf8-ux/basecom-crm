import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, like } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, notifications, users } from "../db/schema.js";
import type { PublicUser } from "../auth/service.js";
import { notifyLeadOrAdmin } from "../notifications/service.js";

/**
 * «Pedir ajuda» (26 nov, desenho aprovado): o comercial pede ajuda; o Chefe de Equipa (sem equipa: o Administrador)
 * recebe um alerta por cima de tudo, com som, e responde «Vou já». O comercial vê «O X vem aí».
 */
export async function requestHelp(db: Db, user: PublicUser, input: { companyId?: string | null; reason?: string | null }) {
  const id = randomUUID();
  const co = input.companyId ? await db.query.companies.findFirst({ where: eq(companies.id, input.companyId) }) : undefined;
  const text = `${user.name} pede ajuda${co ? ` · em chamada com ${co.name}` : ""}${input.reason?.trim() ? ` · ${input.reason.trim()}` : ""}`;
  await notifyLeadOrAdmin(db, user.id, { kind: "help", text, companyId: co?.id, dedupeKey: `help:${id}` });
  return { id };
}

/** Pedidos de ajuda por responder (últimos 30 min) de quem gere. */
export async function pendingHelp(db: Db, user: PublicUser) {
  const since = new Date(Date.now() - 30 * 60_000);
  const rows = await db.select({ id: notifications.id, key: notifications.dedupeKey, text: notifications.text, companyId: notifications.companyId, createdAt: notifications.createdAt, from: users.name })
    .from(notifications).leftJoin(users, eq(users.id, notifications.aboutUserId))
    .where(and(eq(notifications.userId, user.id), eq(notifications.kind, "help"), isNull(notifications.readAt), gt(notifications.createdAt, since)))
    .orderBy(desc(notifications.createdAt));
  return rows.map((r) => ({ id: r.key!.slice(5), text: r.text, companyId: r.companyId, from: r.from, createdAt: r.createdAt }));
}

/** «Vou já»: fecha o pedido para todos os que o receberam e avisa quem pediu. */
export async function ackHelp(db: Db, user: PublicUser, helpId: string) {
  const key = `help:${helpId}`;
  const any = (await db.select().from(notifications).where(and(eq(notifications.dedupeKey, key), eq(notifications.kind, "help"))))[0];
  if (!any) return { ok: false };
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.dedupeKey, key), isNull(notifications.readAt)));
  if (any.aboutUserId) await db.insert(notifications).values({ userId: any.aboutUserId, kind: "help_ack", text: `${user.name} vem aí`, aboutUserId: user.id, dedupeKey: `helpack:${helpId}` }).onConflictDoNothing();
  return { ok: true };
}

/** Estado do meu pedido: à espera ou «O X vem aí». */
export async function helpStatus(db: Db, user: PublicUser, helpId: string) {
  const ack = (await db.select({ text: notifications.text, at: notifications.createdAt }).from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.dedupeKey, `helpack:${helpId}`)))).at(0);
  if (ack) await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, user.id), like(notifications.dedupeKey, `helpack:${helpId}`)));
  return ack ? { acked: true, text: ack.text, at: ack.at } : { acked: false };
}
