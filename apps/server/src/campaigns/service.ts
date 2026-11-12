import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { auditLog, campaignEntries, campaignMembers, campaigns, companies, users } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";

/**
 * Campanhas (Fase 3). Regras aprovadas aplicadas na escolha das empresas:
 * - «Não contactar», empresas encerradas e as que ainda estão no prazo de reutilização ficam de fora;
 * - empresas de outra carteira nunca entram nas campanhas de quem não é responsável (regra fixa);
 * - só entram empresas com pelo menos um telefone válido;
 * - uma empresa não fica em duas campanhas ativas ao mesmo tempo (evita duas chamadas à mesma empresa).
 */

export const filtersSchema = z.object({
  accountType: z.enum(["client", "prospect"]).optional(),
  districts: z.array(z.string()).max(50).optional(),
  municipalities: z.array(z.string()).max(400).optional(),
  sectors: z.array(z.string()).max(50).optional(),
  operators: z.array(z.string()).max(20).optional(),
  sizes: z.array(z.string()).max(10).optional(),
  products: z.array(z.string()).max(50).optional(),
  technologies: z.array(z.string()).max(20).optional(),
  portalStatus: z.array(z.string()).max(5).optional(),
  /** Campanha NBO da NOS, sem as ofertas (ex.: «SOMA | Adicionar fixo»). */
  nboCampaigns: z.array(z.string()).max(50).optional(),
  loyaltyEndFrom: z.string().date().optional(),
  loyaltyEndTo: z.string().date().optional(),
  /** Só empresas sem carteira (ignora as carteiras dos comerciais da campanha). */
  onlyWithoutOwner: z.boolean().optional(),
});
export type CampaignFilters = z.infer<typeof filtersSchema>;

const inList = (col: SQL, v?: string[]) => (v && v.length ? sql`${col} in (${sql.join(v.map((x) => sql`${x}`), sql`, `)})` : undefined);

/** Condição SQL das empresas elegíveis para uma campanha (alias «c»). */
function eligible(f: CampaignFilters, memberIds: string[], excludeCampaignId?: string) {
  const parts: (SQL | undefined)[] = [
    sql`not c.do_not_contact`, sql`not c.inactive`,
    sql`(c.campaign_eligible_from is null or c.campaign_eligible_from <= current_date)`,
    sql`exists (select 1 from company_contacts cc where cc.company_id = c.id and cc.kind = 'phone' and cc.status = 'valid')`,
    f.onlyWithoutOwner || !memberIds.length ? sql`c.owner_id is null`
      : sql`(c.owner_id is null or c.owner_id in (${sql.join(memberIds.map((m) => sql`${m}::uuid`), sql`, `)}))`,
    sql`not exists (select 1 from campaign_entries e join campaigns k on k.id = e.campaign_id where e.company_id = c.id and e.status = 'pending' and k.status <> 'ended'${excludeCampaignId ? sql` and k.id <> ${excludeCampaignId}::uuid` : sql``})`,
    f.accountType ? sql`c.account_type = ${f.accountType}` : undefined,
    inList(sql`c.district`, f.districts), inList(sql`c.municipality`, f.municipalities), inList(sql`c.sector`, f.sectors),
    inList(sql`c.operator`, f.operators), inList(sql`c.size`, f.sizes), inList(sql`c.product`, f.products),
    inList(sql`c.technology`, f.technologies), inList(sql`c.portal_status`, f.portalStatus),
    inList(sql`trim(split_part(c.nbo_campaign, ' — ', 1))`, f.nboCampaigns),
    f.loyaltyEndFrom ? sql`c.loyalty_end >= ${f.loyaltyEndFrom}` : undefined,
    f.loyaltyEndTo ? sql`c.loyalty_end <= ${f.loyaltyEndTo}` : undefined,
  ];
  return sql.join(parts.filter(Boolean) as SQL[], sql` and `);
}

export async function previewCampaign(db: Db, f: CampaignFilters, memberIds: string[]) {
  const r = await db.execute(sql`select count(*)::int as total,
      count(*) filter (where c.account_type = 'client')::int as clients,
      count(*) filter (where c.owner_id is not null)::int as in_wallet
    from companies c where ${eligible(f, memberIds)}`);
  return r.rows[0] as { total: number; clients: number; in_wallet: number };
}

/** Acrescenta à campanha as empresas elegíveis que ainda não estão nela. */
async function fillEntries(db: Db, campaignId: string, f: CampaignFilters, memberIds: string[]) {
  const r = await db.execute(sql`insert into campaign_entries (campaign_id, company_id, assigned_to)
    select ${campaignId}::uuid, c.id, c.owner_id from companies c
    where ${eligible(f, memberIds, campaignId)}
      and not exists (select 1 from campaign_entries e where e.campaign_id = ${campaignId}::uuid and e.company_id = c.id)`);
  return r.rowCount ?? 0;
}

async function checkMembers(db: Db, ids: string[]) {
  if (!ids.length) throw new AuthError(400, "Escolha pelo menos um comercial para a campanha.");
  const rows = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), eq(users.active, true)));
  if (rows.length !== ids.length) throw new AuthError(400, "Há comerciais inativos ou inexistentes na campanha.");
}

export async function createCampaign(db: Db, by: PublicUser, input: { name: string; mode: "new" | "current"; script: string; filters: CampaignFilters; memberIds: string[] }) {
  await checkMembers(db, input.memberIds);
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(campaigns).values({ name: input.name.trim(), mode: input.mode, script: input.script, filters: input.filters, createdBy: by.id }).returning();
    await tx.insert(campaignMembers).values(input.memberIds.map((userId) => ({ campaignId: c!.id, userId })));
    const added = await fillEntries(tx as unknown as Db, c!.id, input.filters, input.memberIds);
    await tx.insert(auditLog).values({ userId: by.id, action: "campanha_criada", entity: "campaign", entityId: c!.id, details: `${c!.name}: ${added} empresas` });
    return { id: c!.id, added };
  });
}

export async function updateCampaign(db: Db, by: PublicUser, id: string, patch: { name?: string; script?: string; status?: "active" | "paused" | "ended"; memberIds?: string[] }) {
  const c = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) });
  if (!c) throw new AuthError(404, "Campanha não encontrada.");
  if (patch.memberIds) await checkMembers(db, patch.memberIds);
  await db.transaction(async (tx) => {
    await tx.update(campaigns).set({ ...(patch.name ? { name: patch.name.trim() } : {}), ...(patch.script !== undefined ? { script: patch.script } : {}), ...(patch.status ? { status: patch.status } : {}), updatedAt: new Date() }).where(eq(campaigns.id, id));
    if (patch.memberIds) {
      await tx.delete(campaignMembers).where(eq(campaignMembers.campaignId, id));
      await tx.insert(campaignMembers).values(patch.memberIds.map((userId) => ({ campaignId: id, userId })));
    }
    // Terminar a campanha liberta as empresas pendentes para outras campanhas.
    if (patch.status === "ended") await tx.update(campaignEntries).set({ status: "removed" }).where(and(eq(campaignEntries.campaignId, id), eq(campaignEntries.status, "pending")));
    await tx.insert(auditLog).values({ userId: by.id, action: "campanha_alterada", entity: "campaign", entityId: id, details: JSON.stringify({ ...patch, script: patch.script !== undefined ? "(alterado)" : undefined }) });
  });
}

export async function refreshCampaign(db: Db, by: PublicUser, id: string) {
  const c = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) });
  if (!c) throw new AuthError(404, "Campanha não encontrada.");
  if (c.status === "ended") throw new AuthError(409, "A campanha está terminada.");
  const members = (await db.select({ id: campaignMembers.userId }).from(campaignMembers).where(eq(campaignMembers.campaignId, id))).map((m) => m.id);
  const added = await fillEntries(db, id, c.filters as CampaignFilters, members);
  await db.insert(auditLog).values({ userId: by.id, action: "campanha_atualizada", entity: "campaign", entityId: id, details: `${added} empresas acrescentadas` });
  return { added };
}

/** Campanhas visíveis: o Administrador vê todas; os outros, as atribuídas. */
export async function listCampaigns(db: Db, by: PublicUser) {
  const mine = by.role === "admin" ? sql`true` : sql`exists (select 1 from campaign_members m where m.campaign_id = k.id and m.user_id = ${by.id}::uuid)`;
  const r = await db.execute(sql`select k.id, k.name, k.mode, k.status, k.script, k.filters, k.created_at as "createdAt",
      coalesce((select json_agg(json_build_object('id', u.id, 'name', u.name) order by u.name) from campaign_members m join users u on u.id = m.user_id where m.campaign_id = k.id), '[]') as members,
      (select count(*)::int from campaign_entries e where e.campaign_id = k.id) as total,
      (select count(*)::int from campaign_entries e where e.campaign_id = k.id and e.status = 'pending') as pending,
      (select count(*)::int from campaign_entries e where e.campaign_id = k.id and e.status = 'pending' and (e.next_at is null or e.next_at <= now())) as ready,
      (select count(*)::int from campaign_entries e where e.campaign_id = k.id and e.status = 'done') as done,
      (select count(*)::int from campaign_entries e where e.campaign_id = k.id and e.status = 'exhausted') as exhausted
    from campaigns k where ${mine} order by (k.status = 'ended'), k.created_at desc`);
  return r.rows;
}
