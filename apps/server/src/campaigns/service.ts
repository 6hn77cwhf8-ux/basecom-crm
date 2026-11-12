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
  /** Valor L2B (mensalidade NOS): intervalos escolhidos (ex.: 0–50, 50–100) e/ou mínimo e máximo. */
  l2bRanges: z.array(z.tuple([z.number().min(0), z.number().min(0).nullable()])).max(20).optional(),
  l2bMin: z.number().min(0).optional(),
  l2bMax: z.number().min(0).optional(),
  /** Meses para o fim da permanência: até 9, até 21, mais de 21. */
  loyaltyMonths: z.array(z.enum(["le9", "le21", "gt21"])).max(3).optional(),
  /** Trazer para esta campanha empresas por trabalhar noutras campanhas (exceto as reservadas a um comercial). */
  takeFromOtherCampaigns: z.boolean().optional(),
});
export type CampaignFilters = z.infer<typeof filtersSchema>;

const inList = (col: SQL, v?: string[]) => (v && v.length ? sql`${col} in (${sql.join(v.map((x) => sql`${x}`), sql`, `)})` : undefined);

/** Filtros escolhidos pelo Administrador (alias «c»). */
function filterCond(f: CampaignFilters) {
  const parts: (SQL | undefined)[] = [
    f.accountType ? sql`c.account_type = ${f.accountType}` : undefined,
    inList(sql`c.district`, f.districts), inList(sql`c.municipality`, f.municipalities), inList(sql`c.sector`, f.sectors),
    inList(sql`c.operator`, f.operators), inList(sql`c.size`, f.sizes), inList(sql`c.product`, f.products),
    inList(sql`c.technology`, f.technologies), inList(sql`c.portal_status`, f.portalStatus),
    inList(sql`trim(split_part(c.nbo_campaign, ' — ', 1))`, f.nboCampaigns),
    f.loyaltyEndFrom ? sql`c.loyalty_end >= ${f.loyaltyEndFrom}` : undefined,
    f.loyaltyEndTo ? sql`c.loyalty_end <= ${f.loyaltyEndTo}` : undefined,
    f.l2bRanges?.length ? sql`(${sql.join(f.l2bRanges.map(([a, b]) => (b == null ? sql`c.l2b_monthly >= ${a}` : sql`(c.l2b_monthly >= ${a} and c.l2b_monthly < ${b})`)), sql` or `)})` : undefined,
    f.l2bMin != null ? sql`c.l2b_monthly >= ${f.l2bMin}` : undefined,
    f.l2bMax != null ? sql`c.l2b_monthly <= ${f.l2bMax}` : undefined,
    f.loyaltyMonths?.length ? sql`(${sql.join(f.loyaltyMonths.map((m) => (m === "le9" ? sql`c.loyalty_months <= 9` : m === "le21" ? sql`c.loyalty_months <= 21` : sql`c.loyalty_months > 21`)), sql` or `)})` : undefined,
  ];
  const ok = parts.filter(Boolean) as SQL[];
  return ok.length ? sql.join(ok, sql` and `) : sql`true`;
}

/** Regras fixas (porque uma empresa pode ficar de fora), cada uma com o seu nome para explicar contagens a zero. */
function ruleConds(f: CampaignFilters, memberIds: string[], excludeCampaignId?: string) {
  const other = sql`exists (select 1 from campaign_entries e join campaigns k on k.id = e.campaign_id where e.company_id = c.id and e.status = 'pending' and k.status <> 'ended'${excludeCampaignId ? sql` and k.id <> ${excludeCampaignId}::uuid` : sql``}${f.takeFromOtherCampaigns ? sql` and (e.assigned_to is not null or e.locked_until > now())` : sql``})`;
  return {
    blocked: sql`(c.do_not_contact or c.inactive)`,
    cooldown: sql`(c.campaign_eligible_from is not null and c.campaign_eligible_from > current_date)`,
    noPhone: sql`not exists (select 1 from company_contacts cc where cc.company_id = c.id and cc.kind = 'phone' and cc.status = 'valid')`,
    otherWallet: f.onlyWithoutOwner || !memberIds.length ? sql`c.owner_id is not null`
      : sql`(c.owner_id is not null and c.owner_id not in (${sql.join(memberIds.map((m) => sql`${m}::uuid`), sql`, `)}))`,
    otherCampaign: other,
  };
}

/** Condição SQL das empresas elegíveis para uma campanha (alias «c»). */
function eligible(f: CampaignFilters, memberIds: string[], excludeCampaignId?: string) {
  const r = ruleConds(f, memberIds, excludeCampaignId);
  return sql`${filterCond(f)} and not ${r.blocked} and not ${r.cooldown} and not ${r.noPhone} and not ${r.otherWallet} and not ${r.otherCampaign}`;
}

export async function previewCampaign(db: Db, f: CampaignFilters, memberIds: string[]) {
  const r0 = ruleConds(f, memberIds);
  // Explica as que ficam de fora (cada empresa conta só no primeiro motivo, pela ordem abaixo).
  const r = await db.execute(sql`select count(*)::int as matching,
      count(*) filter (where ${eligible(f, memberIds)})::int as total,
      count(*) filter (where ${eligible(f, memberIds)} and c.account_type = 'client')::int as clients,
      count(*) filter (where ${eligible(f, memberIds)} and c.owner_id is not null)::int as in_wallet,
      count(*) filter (where ${r0.blocked})::int as blocked,
      count(*) filter (where not ${r0.blocked} and ${r0.cooldown})::int as cooldown,
      count(*) filter (where not ${r0.blocked} and not ${r0.cooldown} and ${r0.noPhone})::int as no_phone,
      count(*) filter (where not ${r0.blocked} and not ${r0.cooldown} and not ${r0.noPhone} and ${r0.otherWallet})::int as other_wallet,
      count(*) filter (where not ${r0.blocked} and not ${r0.cooldown} and not ${r0.noPhone} and not ${r0.otherWallet} and ${r0.otherCampaign})::int as other_campaign
    from companies c where ${filterCond(f)}`);
  return r.rows[0] as { matching: number; total: number; clients: number; in_wallet: number; blocked: number; cooldown: number; no_phone: number; other_wallet: number; other_campaign: number };
}

/** Acrescenta à campanha as empresas elegíveis que ainda não estão nela. */
async function fillEntries(db: Db, campaignId: string, f: CampaignFilters, memberIds: string[]) {
  // Trazer de outras campanhas: as entradas por trabalhar (não reservadas a ninguém) saem das outras campanhas.
  if (f.takeFromOtherCampaigns) {
    await db.execute(sql`update campaign_entries e set status = 'removed' from campaigns k, companies c
      where k.id = e.campaign_id and c.id = e.company_id and e.status = 'pending' and k.id <> ${campaignId}::uuid and k.status <> 'ended'
        and e.assigned_to is null and (e.locked_until is null or e.locked_until < now())
        and ${filterCond(f)} and not (c.do_not_contact or c.inactive)`);
  }
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

export async function createCampaign(db: Db, by: PublicUser, input: { name: string; mode: "new" | "current"; script: string; scriptPitchNew?: string | null; scriptPitchCurrent?: string | null; dialMode?: "power" | "preview"; filters: CampaignFilters; memberIds: string[] }) {
  await checkMembers(db, input.memberIds);
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(campaigns).values({ name: input.name.trim(), mode: input.mode, script: input.script, scriptPitchNew: input.scriptPitchNew || null, scriptPitchCurrent: input.scriptPitchCurrent || null, dialMode: input.mode === "current" ? input.dialMode ?? "power" : "power", filters: input.filters, createdBy: by.id }).returning();
    await tx.insert(campaignMembers).values(input.memberIds.map((userId) => ({ campaignId: c!.id, userId })));
    const added = await fillEntries(tx as unknown as Db, c!.id, input.filters, input.memberIds);
    await tx.insert(auditLog).values({ userId: by.id, action: "campanha_criada", entity: "campaign", entityId: c!.id, details: `${c!.name}: ${added} empresas` });
    return { id: c!.id, added };
  });
}

export async function updateCampaign(db: Db, by: PublicUser, id: string, patch: { name?: string; script?: string; scriptPitchNew?: string | null; scriptPitchCurrent?: string | null; dialMode?: "power" | "preview"; status?: "active" | "paused" | "ended"; memberIds?: string[] }) {
  const c = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) });
  if (!c) throw new AuthError(404, "Campanha não encontrada.");
  if (patch.dialMode === "preview" && c.mode !== "current") throw new AuthError(400, "O modo Preview só existe nas campanhas de clientes atuais.");
  if (patch.memberIds) await checkMembers(db, patch.memberIds);
  await db.transaction(async (tx) => {
    await tx.update(campaigns).set({ ...(patch.name ? { name: patch.name.trim() } : {}), ...(patch.script !== undefined ? { script: patch.script } : {}),
      ...(patch.dialMode ? { dialMode: patch.dialMode } : {}), ...(patch.scriptPitchNew !== undefined ? { scriptPitchNew: patch.scriptPitchNew || null } : {}), ...(patch.scriptPitchCurrent !== undefined ? { scriptPitchCurrent: patch.scriptPitchCurrent || null } : {}), ...(patch.status ? { status: patch.status } : {}), updatedAt: new Date() }).where(eq(campaigns.id, id));
    if (patch.memberIds) {
      await tx.delete(campaignMembers).where(eq(campaignMembers.campaignId, id));
      await tx.insert(campaignMembers).values(patch.memberIds.map((userId) => ({ campaignId: id, userId })));
    }
    // Terminar a campanha liberta as empresas pendentes para outras campanhas.
    if (patch.status === "ended") await tx.update(campaignEntries).set({ status: "removed" }).where(and(eq(campaignEntries.campaignId, id), eq(campaignEntries.status, "pending")));
    await tx.insert(auditLog).values({ userId: by.id, action: "campanha_alterada", entity: "campaign", entityId: id, details: JSON.stringify({ ...patch, script: patch.script !== undefined ? "(alterado)" : undefined, scriptPitchNew: patch.scriptPitchNew !== undefined ? "(alterado)" : undefined, scriptPitchCurrent: patch.scriptPitchCurrent !== undefined ? "(alterado)" : undefined }) });
  });
}

export async function refreshCampaign(db: Db, by: PublicUser, id: string, takeFromOtherCampaigns = false) {
  const c = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) });
  if (!c) throw new AuthError(404, "Campanha não encontrada.");
  if (c.status === "ended") throw new AuthError(409, "A campanha está terminada.");
  const members = (await db.select({ id: campaignMembers.userId }).from(campaignMembers).where(eq(campaignMembers.campaignId, id))).map((m) => m.id);
  const added = await fillEntries(db, id, { ...(c.filters as CampaignFilters), ...(takeFromOtherCampaigns ? { takeFromOtherCampaigns: true } : {}) }, members);
  await db.insert(auditLog).values({ userId: by.id, action: "campanha_atualizada", entity: "campaign", entityId: id, details: `${added} empresas acrescentadas` });
  return { added };
}

/** Campanhas visíveis: o Administrador vê todas; os outros, as atribuídas. */
export async function listCampaigns(db: Db, by: PublicUser) {
  const mine = by.role === "admin" ? sql`true` : sql`exists (select 1 from campaign_members m where m.campaign_id = k.id and m.user_id = ${by.id}::uuid)`;
  const r = await db.execute(sql`select k.id, k.name, k.mode, k.status, k.script, k.script_pitch_new as "scriptPitchNew", k.script_pitch_current as "scriptPitchCurrent", k.dial_mode as "dialMode", k.filters, k.created_at as "createdAt",
      coalesce((select json_agg(json_build_object('id', u.id, 'name', u.name) order by u.name) from campaign_members m join users u on u.id = m.user_id where m.campaign_id = k.id), '[]') as members,
      (select count(*)::int from campaign_entries e where e.campaign_id = k.id) as total,
      (select count(*)::int from campaign_entries e where e.campaign_id = k.id and e.status = 'pending') as pending,
      (select count(*)::int from campaign_entries e where e.campaign_id = k.id and e.status = 'pending' and (e.next_at is null or e.next_at <= now())) as ready,
      (select count(*)::int from campaign_entries e where e.campaign_id = k.id and e.status = 'done') as done,
      (select count(*)::int from campaign_entries e where e.campaign_id = k.id and e.status = 'exhausted') as exhausted
    from campaigns k where ${mine} order by (k.status = 'ended'), k.created_at desc`);
  return r.rows;
}
