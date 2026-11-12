import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, companyContacts } from "../db/schema.js";
import { AuthError, type PublicUser } from "../auth/service.js";
import { startCall } from "../dialer/service.js";
import { visibleUserIds } from "../teams/service.js";

/**
 * C2C / Carteira (maqueta 9): as empresas da carteira de cada comercial, com decisor, telefone, linhas (RGU),
 * próxima ação, último contacto e tarefas abertas. O comercial vê a sua; o Administrador escolhe de quem (ou todas).
 */
export async function walletList(db: Db, user: PublicUser, opts: { ownerId?: string; tasks?: "with" | "without" | "late"; q?: string } = {}) {
  const visible = await visibleUserIds(db, user);
  if (opts.ownerId && visible && !visible.includes(opts.ownerId)) throw new AuthError(403, "Só vê as carteiras da sua equipa.");
  const owners = opts.ownerId ? [opts.ownerId] : visible;
  const q = opts.q?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const r = await db.execute(sql`select c.id, c.name, c.nif, c.wallet_kind as "walletKind", c.l2b_monthly as "l2bMonthly", c.loyalty_end as "loyaltyEnd", u.name as owner,
      (select coalesce(sum(v::int), 0) from jsonb_each_text(coalesce(c.rgu, '{}'::jsonb)) as e(k, v))::int as lines,
      (select concat_ws(' ', p.salutation, p.person_name) from company_contacts p where p.company_id = c.id and p.person_name is not null and p.status <> 'incorrect'
        order by (p.kind = 'person' and p.is_primary) desc, p.is_primary desc, p.created_at limit 1) as decisor,
      (select cc.value from company_contacts cc where cc.company_id = c.id and cc.kind = 'phone' and cc.status = 'valid' order by cc.is_primary desc, cc.created_at limit 1) as phone,
      (select max(k.saved_at) from calls k where k.company_id = c.id and k.saved_at is not null) as "lastContact",
      (select count(*)::int from tasks t where t.company_id = c.id and t.status = 'open') as "openTasks",
      (select json_build_object('type', t.type, 'dueAt', t.due_at) from tasks t where t.company_id = c.id and t.status = 'open' order by t.due_at limit 1) as "nextAction"
    from companies c join users u on u.id = c.owner_id
    where c.owner_id is not null ${owners ? sql`and c.owner_id in (${sql.join(owners.map((w) => sql`${w}::uuid`), sql`, `)})` : sql``}
      ${opts.tasks === "with" ? sql`and exists (select 1 from tasks t where t.company_id = c.id and t.status = 'open')` : sql``}
      ${opts.tasks === "without" ? sql`and not exists (select 1 from tasks t where t.company_id = c.id and t.status = 'open')` : sql``}
      ${opts.tasks === "late" ? sql`and exists (select 1 from tasks t where t.company_id = c.id and t.status = 'open' and t.due_at < now())` : sql``}
      ${q ? (digits.length >= 3 && /^[\d\s+.-]+$/.test(q) ? sql`and (c.nif like ${digits + "%"} or exists (select 1 from company_contacts x where x.company_id = c.id and x.value like ${"%" + digits + "%"}))` : sql`and c.name ilike ${"%" + q + "%"}`) : sql``}
    order by c.name limit 2000`);
  return r.rows as { id: string; name: string; nif: string; walletKind: string; l2bMonthly: string | null; loyaltyEnd: string | null; owner: string; lines: number; decisor: string | null; phone: string | null; lastContact: string | null; openTasks: number; nextAction: { type: string; dueAt: string } | null }[];
}

/** Ligar a partir da Carteira: só o responsável (ou o Administrador); a chamada fica com origem «Carteira». */
export async function callFromWallet(db: Db, user: PublicUser, companyId: string) {
  const co = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
  if (!co) throw new AuthError(404, "Empresa não encontrada.");
  if (user.role !== "admin" && co.ownerId !== user.id) throw new AuthError(403, "Esta empresa não é da sua carteira.");
  const [phone] = await db.select().from(companyContacts).where(and(eq(companyContacts.companyId, co.id), eq(companyContacts.kind, "phone"), eq(companyContacts.status, "valid")))
    .orderBy(sql`${companyContacts.isPrimary} desc`, asc(companyContacts.createdAt)).limit(1);
  if (!phone) throw new AuthError(409, "A empresa não tem telefone válido.");
  const c = await startCall(db, user, { companyId: co.id, contactId: phone.id, entryId: null, source: "wallet" });
  return { callId: c.id, phone: { id: phone.id, value: phone.value, type: phone.phoneType } };
}
