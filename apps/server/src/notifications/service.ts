import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { notifications, users } from "../db/schema.js";
import type { PublicUser } from "../auth/service.js";

type Kind = "result_late" | "break_over" | "training_over" | "switch_over";

/**
 * Envia um aviso às pessoas com estes perfis. Enquanto não houver equipas, os avisos do Chefe de Equipa
 * também chegam ao Administrador. Com dedupeKey, o mesmo aviso não se repete.
 */
export async function notify(db: Db, roles: ("admin" | "team_lead")[], n: { kind: Kind; text: string; aboutUserId?: string; companyId?: string; dedupeKey?: string }) {
  const to = await db.select({ id: users.id }).from(users).where(and(eq(users.active, true), inArray(users.role, roles)));
  const rows = to.filter((u) => u.id !== n.aboutUserId).map((u) => ({ userId: u.id, kind: n.kind, text: n.text, aboutUserId: n.aboutUserId ?? null, companyId: n.companyId ?? null, dedupeKey: n.dedupeKey ?? null }));
  if (rows.length) await db.insert(notifications).values(rows).onConflictDoNothing();
}

export async function myNotifications(db: Db, user: PublicUser) {
  const list = await db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(50);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)))) as [{ n: number }];
  return { unread: n, items: list.map((x) => ({ id: x.id, kind: x.kind, text: x.text, companyId: x.companyId, createdAt: x.createdAt, read: !!x.readAt })) };
}

export async function markRead(db: Db, user: PublicUser) {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
}
