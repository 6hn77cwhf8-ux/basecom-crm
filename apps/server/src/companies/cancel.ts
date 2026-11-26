import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

/**
 * Recusa, Perdida ou Ganha (26 nov): anula tudo o que estava em espera para a empresa — entradas de campanha por
 * trabalhar (callbacks, follow-ups, «Não atende» a voltar a tentar) e as tarefas de vendas em aberto (as da
 * oportunidade e as criadas por chamadas). Tarefas manuais e tickets ficam. Chamar ANTES de criar as tarefas novas do fecho.
 */
export async function cancelPendingWork(db: Db, companyId: string, opts: { exceptEntryId?: string | null } = {}) {
  const entries = await db.execute(sql`update campaign_entries set status = 'removed', locked_by = null, locked_until = null
    where company_id = ${companyId}::uuid and status = 'pending'${opts.exceptEntryId ? sql` and id <> ${opts.exceptEntryId}::uuid` : sql``}`);
  const tasks = await db.execute(sql`update tasks set status = 'cancelled', done_at = now()
    where company_id = ${companyId}::uuid and status = 'open'
      and (opportunity_id is not null or origin in ('call', 'opportunity'))`);
  return { entries: entries.rowCount ?? 0, tasks: tasks.rowCount ?? 0 };
}

/** Condição SQL (alias «c»): a empresa pode ser marcada agora (fora de prazos de recusa, Não contactar, Insatisfeito NOS). */
export const callableNow = sql`not c.do_not_contact and not c.inactive
  and (c.campaign_eligible_from is null or c.campaign_eligible_from <= current_date)
  and (c.dissatisfied_until is null or c.dissatisfied_until <= current_date)`;
