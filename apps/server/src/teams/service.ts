import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { auditLog, teamMembers, teams, users } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";

/**
 * Equipas e visibilidade (CLAUDE.md, «Visibilidade de tempos»): o comercial vê o seu; o Chefe de Equipa a sua equipa;
 * o Administrador toda a estrutura. Devolve null quando o ator vê todos.
 */
export async function visibleUserIds(db: Db, actor: { id: string; role: string }): Promise<string[] | null> {
  if (actor.role === "admin") return null;
  if (actor.role !== "team_lead") return [actor.id];
  const r = await db.execute(sql`select m.user_id as id from team_members m join teams t on t.id = m.team_id where t.lead_id = ${actor.id}::uuid`);
  return [actor.id, ...(r.rows as { id: string }[]).map((x) => x.id)];
}

export async function canSee(db: Db, actor: { id: string; role: string }, userId: string) {
  const v = await visibleUserIds(db, actor);
  return v === null || v.includes(userId);
}

/** Chefes de Equipa de uma pessoa (para avisos). Vazio quando não está em nenhuma equipa com chefe. */
export async function leadsOf(db: Db, userId: string): Promise<string[]> {
  const r = await db.execute(sql`select t.lead_id as id from team_members m join teams t on t.id = m.team_id where m.user_id = ${userId}::uuid and t.lead_id is not null and t.lead_id <> ${userId}::uuid`);
  return (r.rows as { id: string }[]).map((x) => x.id);
}

export async function listTeams(db: Db) {
  const r = await db.execute(sql`select t.id, t.name, t.lead_id as "leadId", l.name as "leadName",
      coalesce((select json_agg(json_build_object('id', u.id, 'name', u.name) order by u.name) from team_members m join users u on u.id = m.user_id where m.team_id = t.id), '[]') as members
    from teams t left join users l on l.id = t.lead_id order by t.name`);
  return r.rows as { id: string; name: string; leadId: string | null; leadName: string | null; members: { id: string; name: string }[] }[];
}

/** Criar ou alterar uma equipa (Administrador). Um comercial que já estava noutra equipa passa para esta. */
export async function saveTeam(db: Db, by: PublicUser, input: { id?: string; name: string; leadId: string | null; memberIds: string[] }) {
  if (by.role !== "admin") throw new AuthError(403, "Só o Administrador gere equipas.");
  if (input.name.trim().length < 2) throw new AuthError(400, "Dê um nome à equipa.");
  if (input.leadId) {
    const lead = await db.query.users.findFirst({ where: eq(users.id, input.leadId) });
    if (!lead || lead.role !== "team_lead") throw new AuthError(400, "O chefe tem de ter o perfil Chefe de Equipa (Equipa comercial → editar utilizador).");
  }
  return db.transaction(async (tx) => {
    let id = input.id;
    if (id) await tx.update(teams).set({ name: input.name.trim(), leadId: input.leadId }).where(eq(teams.id, id));
    else id = (await tx.insert(teams).values({ name: input.name.trim(), leadId: input.leadId }).returning())[0]!.id;
    await tx.delete(teamMembers).where(eq(teamMembers.teamId, id));
    const members = input.memberIds.filter((m) => m !== input.leadId);
    if (members.length) {
      await tx.delete(teamMembers).where(inArray(teamMembers.userId, members));
      await tx.insert(teamMembers).values(members.map((userId) => ({ teamId: id!, userId })));
    }
    await tx.insert(auditLog).values({ userId: by.id, action: "equipa_alterada", entity: "team", entityId: id, details: `${input.name.trim()}: ${members.length} comerciais` });
    return { id };
  });
}

export async function deleteTeam(db: Db, by: PublicUser, id: string) {
  if (by.role !== "admin") throw new AuthError(403, "Só o Administrador gere equipas.");
  await db.delete(teams).where(eq(teams.id, id));
  await db.insert(auditLog).values({ userId: by.id, action: "equipa_apagada", entity: "team", entityId: id });
}

/** Pessoas que este ator pode consultar (seletores «Agenda de», «Carteira de», «Comercial»). */
export async function visiblePeople(db: Db, actor: { id: string; role: string }) {
  const v = await visibleUserIds(db, actor);
  return db.select({ id: users.id, name: users.name, role: users.role }).from(users)
    .where(and(eq(users.active, true), v === null ? sql`true` : inArray(users.id, v))).orderBy(users.name);
}
