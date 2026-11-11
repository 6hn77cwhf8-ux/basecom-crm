import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  cleanNif, isValidNif, normalizeCompanyName, normalizeOperator, normalizePhone, splitHistory, splitSalutation, toEuros, toIsoDate,
  type OperatorConfig,
} from "@basecom/shared";
import type { Db } from "../db/client.js";
import { auditLog, companies, companyContacts, companyNotes, importBatches, importRows, users } from "../db/schema.js";
import { AuthError } from "../auth/service.js";
import { getSetting, setSetting } from "../settings.js";
import { readWorkbook, type Sheet } from "./excel.js";

/**
 * Importação da base de empresas (documento «Importação e reconciliação»):
 * análise → mapeamento → zona de preparação (pré-visualização) → gravação com 2FA → lote anulável.
 */

/** Campos do CRM a que uma coluna do Excel pode corresponder. */
export const FIELDS = {
  nif: "NIF", name: "Nome da empresa", accountType: "Tipo de conta", size: "Dimensão", employeesBand: "Escalão de colaboradores",
  l2b: "Valor L2B (mensalidade NOS)", approachCycle: "Ciclo de abordagem (histórico)", phone: "Telefone", loyaltyEnd: "Fim de fidelização",
  owner: "Comercial responsável", economicGroup: "Grupo económico", decisor: "Decisor (contacto principal)", email: "Email",
  address: "Morada", postalCode: "Código postal", municipality: "Concelho", locality: "Localidade", operator: "Operadora atual",
  lastFeedback: "Último feedback (histórico)", feedbackHistory: "Histórico de feedback", lastSourceYear: "Ano da última fonte",
  sources: "Fontes (origem)", reason: "Motivo (nota)",
  title: "Título do decisor", title2: "Título do 2.º decisor", decisor2: "2.º decisor", email2: "Email do 2.º decisor",
  extraPhones: "Telefones adicionais (separados por ;)", district: "Distrito", sector: "Setor", annualRevenue: "Faturação anual (€)",
  locationsPotential: "Potencial de localizações", product: "Produto NOS", technology: "Tecnologia", loyaltyMonths: "Meses de permanência",
  portalStatus: "Estado no portal NOS", nosExit: "Data de saída da NOS", nboCampaign: "Campanha NBO",
  rguVM: "RGU Voz Móvel (VM)", rguDM: "RGU Dados Móveis (DM)", rguIM: "RGU Internet Móvel (IM)", rguVF: "RGU Voz Fixa (VF)",
  rguDF: "RGU Dados Fixos (DF)", rguIF: "RGU Internet Fixa (IF)", rguTV: "RGU TV", rguIT: "RGU IT", rguAlarmes: "RGU Alarmes",
  ignore: "Não importar",
} as const;

export const RGU_KEYS = ["VM", "DM", "IM", "VF", "DF", "IF", "TV", "IT", "Alarmes"] as const;
export type Field = keyof typeof FIELDS;

/** Mapeamento aprovado no fecho da Fase 01 (tabela «Mapeamento das colunas da base»). */
export const DEFAULT_MAPPING: Record<string, Field> = {
  "NIF da Empresa": "nif", "Nome da Empresa": "name", "Nome da Lead": "ignore", "Localidade": "locality", "Concelho": "municipality",
  "Morada": "address", "Código Postal": "postalCode", "Tipo de Conta": "accountType", "Dimensão da Empresa": "size",
  "Nº de Colaboradores": "employeesBand", "Valor L2B (€)": "l2b", "Ciclo de Abordagem": "approachCycle", "Nº de Chamadas": "ignore",
  "Contacto 1": "phone", "Contacto 2": "phone", "Contacto 3": "phone", "Contacto 4": "phone",
  "Fim de Fidelização / Permanência": "loyaltyEnd", "Comercial Responsável": "owner", "Grupo Económico": "economicGroup",
  "Decisor": "decisor", "Email": "email", "Operadora": "operator", "Último Feedback": "lastFeedback", "Histórico Feedback": "feedbackHistory",
  "Ganho Fecho 2026 (€)": "ignore", "Ano Última Fonte": "lastSourceYear", "Tags": "ignore", "Fontes": "sources",
  "Feedback": "ignore", "Data": "ignore", "Comentários": "ignore", "Motivo da remoção": "reason",
  // Formato acordado a 11 nov (ficheiro «BASECOM_Importacao_CRM», 47 colunas).
  "Título": "title", "Título 2": "title2", "Decisor 2": "decisor2", "Email 2": "email2", "Contactos adicionais": "extraPhones",
  "Distrito": "district", "Setor": "sector", "Setor (CAE agregado)": "sector", "Faturação Anual (€)": "annualRevenue",
  "Potencial Nº Localizações": "locationsPotential", "Produto": "product", "Tecnologia": "technology", "Meses Permanência": "loyaltyMonths",
  "Estado no Portal": "portalStatus", "Data Saída NOS": "nosExit", "Campanha NBO": "nboCampaign",
  "Voz Móvel (VM)": "rguVM", "Dados Móveis (DM)": "rguDM", "Internet Móvel (IM)": "rguIM", "Voz Fixa (VF)": "rguVF",
  "Dados Fixos (DF)": "rguDF", "Internet Fixa (IF)": "rguIF", "TV": "rguTV", "IT": "rguIT", "Alarmes": "rguAlarmes",
};

export type SheetAction = "import" | "review" | "skip";
/**
 * Decisão de 11 nov (substitui a de 10 nov): só entram as folhas NC e NN. As restantes
 * (fontes, análises, empresas sem contacto) ficam por importar; o Administrador pode mudar no ecrã.
 */
export function defaultSheetAction(name: string, _headers: string[]): SheetAction {
  const n = name.trim().toUpperCase();
  return n === "NC" || n === "NN" ? "import" : "skip";
}

export type Result = "new" | "update" | "duplicate_review" | "nif_to_verify" | "blocked" | "review" | "rejected";
export const RESULT_LABEL: Record<Result, string> = {
  new: "Nova", update: "Atualizar", duplicate_review: "Duplicado a rever", nif_to_verify: "NIF a verificar",
  blocked: "Bloqueada (RGPD)", review: "Lista de revisão", rejected: "Rejeitada",
};

/** Linha normalizada, pronta a gravar. */
export type Staged = {
  nif: string; nifValid: boolean; name: string; nameKey: string; accountType: "client" | "prospect";
  size: string | null; employeesBand: string | null; l2bMonthly: number | null; loyaltyEnd: string | null;
  address: string | null; postalCode: string | null; locality: string | null; municipality: string | null;
  operator: string | null; economicGroup: string | null; ownerId: string | null; ownerLabel: string;
  lastSourceYear: number | null; sources: string | null;
  phones: { value: string; type: string }[]; email: string | null; decisor: { salutation: string | null; name: string } | null;
  decisor2: { salutation: string | null; name: string } | null; email2: string | null;
  extra: Extra;
  notes: { kind: string; text: string }[];
};

/** Campos simples que passam tal e qual para a empresa (na atualização: substituem se vierem preenchidos). */
export type Extra = {
  district: string | null; sector: string | null; annualRevenue: number | null; locationsPotential: string | null;
  rgu: Record<string, number> | null; product: string | null; technology: string | null; loyaltyMonths: number | null;
  portalStatus: string | null; nosExitMonth: string | null; nboCampaign: string | null;
};
const EXTRA_KEYS = ["district", "sector", "annualRevenue", "locationsPotential", "rgu", "product", "technology", "loyaltyMonths", "portalStatus", "nosExitMonth", "nboCampaign"] as const;
function extraColumns(e: Extra) {
  return { ...e, annualRevenue: e.annualRevenue == null ? null : String(e.annualRevenue) };
}

const s = (v: unknown) => (v == null ? "" : String(v).trim());
const orNull = (v: unknown) => s(v) || null;

/**
 * Tranca o lote até ao fim da transação e confirma o estado: a pré-visualização, a gravação
 * e a anulação nunca correm ao mesmo tempo sobre o mesmo lote.
 */
async function lockBatch(tx: Db, batchId: string, allowed: string[], msg: string) {
  const r = await tx.execute(sql`select status from import_batches where id = ${batchId} for update`);
  const status = (r.rows[0] as { status?: string } | undefined)?.status;
  if (!status) throw new AuthError(404, "Lote não encontrado.");
  if (!allowed.includes(status)) throw new AuthError(409, msg);
}

// ───────────── Passo 1: carregar e analisar ─────────────

export async function uploadBase(db: Db, userId: string, fileName: string, data: Buffer) {
  if (!data.length) throw new AuthError(400, "O ficheiro está vazio.");
  let sheets: Sheet[];
  try { sheets = await readWorkbook(data); } catch { throw new AuthError(400, "Não foi possível ler o ficheiro. Confirme que é um Excel (.xlsx)."); }
  const cfg = await getSetting(db, "importBase");
  const mapping = { ...DEFAULT_MAPPING, ...cfg.mapping } as Record<string, string>;
  const analysis = sheets.map((sh) => analyseSheet(sh, mapping));
  const [batch] = await db.insert(importBatches).values({
    kind: "base", fileName, fileSha256: createHash("sha256").update(data).digest("hex"), fileData: data, status: "uploaded",
    options: {}, summary: { analysis }, createdBy: userId,
  }).returning({ id: importBatches.id, number: importBatches.number });
  await db.insert(auditLog).values({ userId, action: "importacao_carregada", entity: "import_batch", entityId: batch!.id, details: fileName });
  return { id: batch!.id, number: batch!.number, fileName, sheets: analysis, fields: FIELDS, mapping, trialSize: cfg.trialSize };
}

function analyseSheet(sh: Sheet, mapping: Record<string, string>) {
  const nifCol = sh.headers.findIndex((h) => mapping[h] === "nif");
  const phoneCols = sh.headers.map((h, i) => (mapping[h] === "phone" ? i : -1)).filter((i) => i >= 0);
  let validNif = 0, invalidNif = 0, emptyNif = 0, phones = 0, badPhones = 0, noContact = 0;
  for (const r of sh.rows) {
    if (nifCol >= 0) {
      const n = cleanNif(r[nifCol] as string);
      if (!n) emptyNif++; else if (isValidNif(n)) validNif++; else invalidNif++;
    }
    let has = false;
    for (const c of phoneCols) {
      const v = s(r[c]);
      if (!v) continue;
      if (normalizePhone(v)) { phones++; has = true; } else badPhones++;
    }
    if (phoneCols.length && !has) noContact++;
  }
  return {
    name: sh.name, rows: sh.rows.length, headers: sh.headers,
    unknownColumns: sh.headers.filter((h) => h && !mapping[h]),
    action: defaultSheetAction(sh.name, sh.headers),
    validNif, invalidNif, emptyNif, phones, badPhones, noContact,
  };
}

// ───────────── Passo 2: pré-visualização (zona de preparação) ─────────────

export type PreviewOptions = { sheets: Record<string, SheetAction>; mapping: Record<string, string>; limit: number | null };

export async function previewBase(db: Db, userId: string, batchId: string, opts: PreviewOptions) {
  const batch = await db.query.importBatches.findFirst({ where: eq(importBatches.id, batchId) });
  if (!batch || batch.kind !== "base") throw new AuthError(404, "Lote não encontrado.");
  if (batch.status !== "uploaded" && batch.status !== "preview") throw new AuthError(409, "Este lote já foi gravado ou anulado.");
  for (const v of Object.values(opts.mapping)) if (!(v in FIELDS)) throw new AuthError(400, `Campo desconhecido no mapeamento: ${v}`);

  const cfg = await getSetting(db, "importBase");
  const sheets = await readWorkbook(batch.fileData);
  const salesUsers = await db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "sales"), eq(users.active, true)));
  const ctx = new Ctx(cfg, salesUsers);

  // Ensaio: limita o total de linhas a importar, repartido pelas folhas na proporção do tamanho.
  const importing = sheets.filter((sh) => opts.sheets[sh.name] === "import");
  const total = importing.reduce((a, sh) => a + sh.rows.length, 0);
  const quota = (sh: Sheet) => (opts.limit && total > opts.limit ? Math.max(1, Math.round((sh.rows.length / total) * opts.limit)) : sh.rows.length);

  type Row = typeof importRows.$inferInsert;
  const rows: Row[] = [];
  const seenInFile = new Map<string, string>();
  for (const sh of sheets) {
    const action = opts.sheets[sh.name] ?? "skip";
    if (action === "skip") continue;
    const col = (f: Field) => sh.headers.map((h, i) => (opts.mapping[h] === f ? i : -1)).filter((i) => i >= 0);
    const take = action === "import" ? quota(sh) : sh.rows.length;
    sh.rows.slice(0, take).forEach((r, i) => {
      const rowNumber = i + 2;
      const get = (f: Field) => { const c = col(f)[0]; return c === undefined ? null : r[c]; };
      const nameRaw = s(get("name")) || s(r[0]);
      if (action === "review") {
        rows.push({ batchId, sheet: sh.name, rowNumber, nif: cleanNif(get("nif") as string) || null, name: nameRaw || null, result: "review", detail: `Folha «${sh.name}»: ${s(get("reason")) || s(r[0]) || "a rever pelo Administrador"}`, data: {} });
        return;
      }
      const staged = ctx.stage(r, col, get);
      if ("error" in staged) {
        rows.push({ batchId, sheet: sh.name, rowNumber, nif: cleanNif(get("nif") as string) || null, name: nameRaw || null, result: staged.result, detail: staged.error, data: {} });
        return;
      }
      const prev = seenInFile.get(staged.nif);
      if (prev) {
        rows.push({ batchId, sheet: sh.name, rowNumber, nif: staged.nif, name: staged.name, result: "review", detail: `NIF repetido no ficheiro (${prev})`, data: staged });
        return;
      }
      seenInFile.set(staged.nif, `${sh.name}, linha ${rowNumber}`);
      rows.push({ batchId, sheet: sh.name, rowNumber, nif: staged.nif, name: staged.name, result: staged.nifValid ? "new" : "nif_to_verify", detail: staged.nifValid ? `Carteira: ${staged.ownerLabel}` : "NIF não passa no dígito de controlo: entra marcada «NIF a verificar»", data: staged });
    });
  }

  await classifyAgainstDb(db, rows);

  await db.transaction(async (tx) => {
    await lockBatch(tx as unknown as Db, batchId, ["uploaded", "preview"], "Este lote já foi gravado ou anulado.");
    await tx.delete(importRows).where(eq(importRows.batchId, batchId));
    for (let i = 0; i < rows.length; i += 1000) await tx.insert(importRows).values(rows.slice(i, i + 1000));
    const summary = summarise(rows);
    await tx.update(importBatches).set({ status: "preview", options: opts, summary: { ...(batch.summary as object), preview: summary } }).where(eq(importBatches.id, batchId));
  });
  // O mapeamento fica guardado para as próximas vezes.
  if (JSON.stringify(cfg.mapping) !== JSON.stringify(opts.mapping)) await setSetting(db, "importBase", { ...cfg, mapping: opts.mapping }, userId);
  return { id: batchId, number: batch.number, summary: summarise(rows) };
}

class Ctx {
  private salesByName: Map<string, { id: string; name: string }>;
  private former: Set<string>;
  constructor(private cfg: { formerSales: string[]; noOwnerName: string; operators: OperatorConfig }, sales: { id: string; name: string }[]) {
    this.salesByName = new Map(sales.map((u) => [u.name.trim().toLowerCase(), u]));
    this.former = new Set(cfg.formerSales.map((n) => n.trim().toLowerCase()));
  }

  stage(r: unknown[], col: (f: Field) => number[], get: (f: Field) => unknown): Staged | { error: string; result: Result } {
    const nif = cleanNif(get("nif") as string);
    const name = s(get("name"));
    if (!nif) return { error: "Sem NIF: sem NIF não há empresa", result: "rejected" };
    if (!name) return { error: "Sem nome da empresa", result: "rejected" };
    const tipo = s(get("accountType")).toLowerCase();
    const accountType = tipo.startsWith("cliente") ? "client" : tipo.startsWith("prospe") ? "prospect" : null;
    if (!accountType) return { error: `Tipo de conta desconhecido: «${s(get("accountType"))}»`, result: "review" };

    // Carteira: todas as NN entram sem carteira; nos clientes decide a coluna Comercial Responsável.
    const ownerRaw = s(get("owner"));
    let ownerId: string | null = null;
    let ownerLabel = "sem carteira";
    if (accountType === "client" && ownerRaw && ownerRaw.toLowerCase() !== this.cfg.noOwnerName.toLowerCase()) {
      const u = this.salesByName.get(ownerRaw.toLowerCase());
      if (u) { ownerId = u.id; ownerLabel = u.name; }
      else if (this.former.has(ownerRaw.toLowerCase())) ownerLabel = `sem carteira (ex-comercial ${ownerRaw})`;
      else return { error: `Comercial desconhecido: «${ownerRaw}»`, result: "review" };
    }

    const notes: Staged["notes"] = [];
    const reason = s(get("reason"));
    if (reason) notes.push({ kind: "note", text: `Motivo indicado na base antiga: ${reason}` });
    const op = normalizeOperator(s(get("operator")), this.cfg.operators);
    if (op.note) notes.push({ kind: "note", text: `Nota da coluna Operadora: ${op.note}` });
    const cycle = s(get("approachCycle"));
    if (cycle) notes.push({ kind: "campaign", text: `Abordada na campanha ${cycle}` });
    const history = splitHistory(s(get("feedbackHistory")));
    for (const h of splitHistory(s(get("lastFeedback")))) if (!history.includes(h)) history.push(h);
    for (const h of history) notes.push({ kind: "feedback", text: h });

    const phones: Staged["phones"] = [];
    for (const c of col("phone")) {
      const raw = s(r[c]);
      if (!raw) continue;
      const p = normalizePhone(raw);
      if (p && !phones.some((x) => x.value === p.national)) phones.push({ value: p.national, type: p.type });
      else if (!p) notes.push({ kind: "note", text: `Telefone inválido na base: ${raw}` });
    }
    // Telefones adicionais (a partir do 5.º), separados por «;».
    for (const raw of s(get("extraPhones")).split(/[;,|/\n]+/)) {
      if (!raw.trim()) continue;
      const p = normalizePhone(raw);
      if (p && !phones.some((x) => x.value === p.national)) phones.push({ value: p.national, type: p.type });
      else if (!p) notes.push({ kind: "note", text: `Telefone inválido na base: ${raw.trim()}` });
    }
    const person = (title: unknown, name: unknown) => {
      const n = s(name);
      if (!n) return null;
      const sp = splitSalutation(n);
      return { salutation: s(title) || sp.salutation, name: sp.name };
    };
    const email = s(get("email")).toLowerCase();
    const email2 = s(get("email2")).toLowerCase();
    const int = (v: unknown) => { const x = toEuros(v); return x != null && Number.isInteger(x) ? x : null; };
    const rgu: Record<string, number> = {};
    for (const k of RGU_KEYS) { const v = int(get(`rgu${k}` as Field)); if (v != null) rgu[k] = v; }
    const exit = s(get("nosExit"));
    const extra: Extra = {
      district: orNull(get("district")), sector: orNull(get("sector")), annualRevenue: toEuros(get("annualRevenue")),
      locationsPotential: orNull(get("locationsPotential")), rgu: Object.keys(rgu).length ? rgu : null,
      product: orNull(get("product")), technology: orNull(get("technology")), loyaltyMonths: int(get("loyaltyMonths")),
      portalStatus: orNull(get("portalStatus")), nosExitMonth: /^\d{4}-\d{2}/.test(exit) ? exit.slice(0, 7) : exit || null,
      nboCampaign: orNull(get("nboCampaign")),
    };
    const year = Number(get("lastSourceYear"));
    return {
      nif, nifValid: isValidNif(nif), name, nameKey: normalizeCompanyName(name), accountType,
      size: orNull(get("size")), employeesBand: orNull(get("employeesBand")), l2bMonthly: toEuros(get("l2b")),
      loyaltyEnd: toIsoDate(get("loyaltyEnd")), address: orNull(get("address")), postalCode: orNull(get("postalCode")),
      locality: orNull(get("locality")), municipality: orNull(get("municipality")), operator: op.operator,
      economicGroup: orNull(get("economicGroup")), ownerId, ownerLabel,
      lastSourceYear: Number.isInteger(year) && year > 1990 && year < 2100 ? year : null, sources: orNull(get("sources")),
      phones, email: email && email.includes("@") ? email : null, decisor: person(get("title"), get("decisor")),
      decisor2: person(get("title2"), get("decisor2")), email2: email2 && email2.includes("@") && email2 !== email ? email2 : null,
      extra, notes,
    };
  }
}

/** Compara com o que já está no CRM: mesmo NIF = atualizar; nome parecido + telefone ou código postal = rever. */
async function classifyAgainstDb(db: Db, rows: (typeof importRows.$inferInsert)[]) {
  const staged = rows.filter((r) => r.result === "new" || r.result === "nif_to_verify");
  const nifs = staged.map((r) => r.nif!);
  const existing = new Map<string, { id: string; doNotContact: boolean }>();
  for (let i = 0; i < nifs.length; i += 5000) {
    const part = await db.select({ id: companies.id, nif: companies.nif, doNotContact: companies.doNotContact }).from(companies).where(inArray(companies.nif, nifs.slice(i, i + 5000)));
    for (const c of part) existing.set(c.nif, c);
  }
  // Índice de nomes (CRM + ficheiro) para detetar duplicados prováveis com NIF diferente.
  const byName = new Map<string, { nif: string; phones: Set<string>; postal: string | null }[]>();
  const add = (key: string, v: { nif: string; phones: Set<string>; postal: string | null }) => { if (key) (byName.get(key) ?? byName.set(key, []).get(key)!).push(v); };
  const keys = [...new Set(staged.map((r) => (r.data as Staged).nameKey).filter(Boolean))];
  for (let i = 0; i < keys.length; i += 5000) {
    const part = await db.select({ id: companies.id, nif: companies.nif, nameKey: companies.nameKey, postal: companies.postalCode }).from(companies).where(inArray(companies.nameKey, keys.slice(i, i + 5000)));
    if (!part.length) continue;
    const ph = await db.select({ companyId: companyContacts.companyId, value: companyContacts.value }).from(companyContacts).where(inArray(companyContacts.companyId, part.map((p) => p.id)));
    for (const p of part) add(p.nameKey, { nif: p.nif, postal: p.postal, phones: new Set(ph.filter((x) => x.companyId === p.id).map((x) => x.value)) });
  }
  for (const r of staged) {
    const d = r.data as Staged;
    const ex = existing.get(d.nif);
    if (ex) {
      r.companyId = ex.id;
      r.result = ex.doNotContact ? "blocked" : "update";
      r.detail = ex.doNotContact ? "Empresa marcada «Não contactar»: a importação não a altera" : "Já existe no CRM (mesmo NIF): acrescenta contactos e histórico";
      continue;
    }
    const twin = (byName.get(d.nameKey) ?? []).find((o) => o.nif !== d.nif && (d.phones.some((p) => o.phones.has(p.value)) || (d.postalCode && o.postal === d.postalCode)));
    if (twin) {
      r.result = "duplicate_review";
      r.detail = `Nome parecido com o NIF ${twin.nif} e mesmo telefone ou código postal: entra e fica na lista de revisão`;
      if (!d.nifValid) r.detail += ". O NIF também não passa no dígito de controlo (NIF a verificar)";
    }
    add(d.nameKey, { nif: d.nif, postal: d.postalCode, phones: new Set(d.phones.map((p) => p.value)) });
  }
}

function summarise(rows: { result: string; data: unknown }[]) {
  const byResult: Record<string, number> = {};
  let clients = 0, prospects = 0, withOwner = 0;
  for (const r of rows) {
    byResult[r.result] = (byResult[r.result] ?? 0) + 1;
    const d = r.data as Partial<Staged>;
    if (["new", "update", "duplicate_review", "nif_to_verify"].includes(r.result)) {
      if (d.accountType === "client") clients++; else if (d.accountType === "prospect") prospects++;
      if (d.ownerId) withOwner++;
    }
  }
  return { total: rows.length, byResult, clients, prospects, withOwner };
}

// ───────────── Passo 3: gravar (com 2FA, verificado na rota) ─────────────

const WRITE = ["new", "duplicate_review", "nif_to_verify"];

export async function commitBase(db: Db, userId: string, batchId: string) {
  const batch = await db.query.importBatches.findFirst({ where: eq(importBatches.id, batchId) });
  if (!batch) throw new AuthError(404, "Lote não encontrado.");
  if (batch.status !== "preview") throw new AuthError(409, "Este lote não está em pré-visualização.");
  const counts = { created: 0, updated: 0, skipped: 0 };

  await db.transaction(async (tx) => {
    await lockBatch(tx as unknown as Db, batchId, ["preview"], "Este lote não está em pré-visualização (já foi gravado, anulado ou está a ser preparado).");
    const rows = await tx.select().from(importRows).where(eq(importRows.batchId, batchId));
    // Empresas novas, em blocos.
    const fresh = rows.filter((r) => WRITE.includes(r.result));
    for (let i = 0; i < fresh.length; i += 500) {
      const part = fresh.slice(i, i + 500);
      const inserted = await tx.insert(companies).values(part.map((r) => {
        const d = r.data as Staged;
        return {
          nif: d.nif, nifValid: d.nifValid, name: d.name, nameKey: d.nameKey, accountType: d.accountType, size: d.size,
          employeesBand: d.employeesBand, l2bMonthly: d.l2bMonthly == null ? null : String(d.l2bMonthly), loyaltyEnd: d.loyaltyEnd,
          address: d.address, postalCode: d.postalCode, locality: d.locality, municipality: d.municipality, operator: d.operator,
          economicGroup: d.economicGroup, ownerId: d.ownerId, lastSourceYear: d.lastSourceYear, sources: d.sources,
          ...(d.extra ? extraColumns(d.extra) : {}),
          needsReview: r.result === "duplicate_review" ? r.detail : null, batchId,
        };
      })).returning({ id: companies.id, nif: companies.nif });
      const idByNif = new Map(inserted.map((c) => [c.nif, c.id]));
      await insertChildren(tx as unknown as Db, part.map((r) => ({ id: idByNif.get((r.data as Staged).nif)!, d: r.data as Staged, known: new Set<string>(), knownNotes: new Set<string>() })), batchId, userId);
      counts.created += part.length;
    }

    await tx.execute(sql`update import_rows r set company_id = c.id from companies c where r.batch_id = ${batchId} and c.batch_id = ${batchId} and c.nif = r.nif`);
    // Histórico de carteira: as empresas que entram já com responsável ficam registadas com origem «importação».
    await tx.execute(sql`insert into wallet_changes (company_id, to_owner_id, kind, effective_from, status, reason, created_by, applied_at)
      select c.id, c.owner_id, 'import', current_date, 'applied', 'Comercial Responsável indicado na base importada', ${userId}, now()
      from companies c where c.batch_id = ${batchId} and c.owner_id is not null`);

    // Atualizações: regras por campo do documento (nunca muda a carteira, nunca apaga contactos).
    for (const r of rows.filter((x) => x.result === "update" && x.companyId)) {
      const d = r.data as Staged;
      const cur = await tx.query.companies.findFirst({ where: eq(companies.id, r.companyId!) });
      if (!cur || cur.doNotContact) { counts.skipped++; continue; }
      const before: Record<string, unknown> = { name: cur.name, nameKey: cur.nameKey, address: cur.address, postalCode: cur.postalCode, municipality: cur.municipality, locality: cur.locality, loyaltyEnd: cur.loyaltyEnd, l2bMonthly: cur.l2bMonthly, size: cur.size };
      const extraSet: Record<string, unknown> = {};
      if (d.extra) {
        const cols = extraColumns(d.extra) as Record<string, unknown>;
        for (const k of EXTRA_KEYS) if (cols[k] != null) { before[k] = (cur as Record<string, unknown>)[k]; extraSet[k] = cols[k]; }
      }
      await tx.update(companies).set({
        name: d.name, nameKey: d.nameKey, address: d.address ?? cur.address, postalCode: d.postalCode ?? cur.postalCode,
        municipality: d.municipality ?? cur.municipality, locality: d.locality ?? cur.locality,
        loyaltyEnd: d.loyaltyEnd ?? cur.loyaltyEnd, l2bMonthly: d.l2bMonthly == null ? cur.l2bMonthly : String(d.l2bMonthly),
        size: d.size ?? cur.size, ...extraSet, updatedAt: new Date(),
      }).where(eq(companies.id, cur.id));
      const known = new Set((await tx.select({ v: companyContacts.value }).from(companyContacts).where(eq(companyContacts.companyId, cur.id))).map((x) => x.v));
      const knownNotes = new Set((await tx.select({ t: companyNotes.text }).from(companyNotes).where(eq(companyNotes.companyId, cur.id))).map((x) => x.t));
      await insertChildren(tx as unknown as Db, [{ id: cur.id, d, known, knownNotes }], batchId, userId);
      await tx.update(importRows).set({ before }).where(eq(importRows.id, r.id));
      counts.updated++;
    }
    await tx.update(importBatches).set({ status: "committed", committedAt: new Date(), summary: { ...(batch.summary as object), committed: counts } }).where(eq(importBatches.id, batchId));
    await tx.insert(auditLog).values({ userId, action: "importacao_gravada", entity: "import_batch", entityId: batchId, details: `Lote ${batch.number}: ${counts.created} novas, ${counts.updated} atualizadas` });
  });
  return { number: batch.number, ...counts };
}

async function insertChildren(tx: Db, items: { id: string; d: Staged; known: Set<string>; knownNotes: Set<string> }[], batchId: string, userId: string) {
  const contacts: (typeof companyContacts.$inferInsert)[] = [];
  const notes: (typeof companyNotes.$inferInsert)[] = [];
  for (const { id, d, known, knownNotes } of items) {
    const firstNew = known.size === 0;
    d.phones.forEach((p, i) => {
      if (known.has(p.value)) return;
      contacts.push({ companyId: id, kind: "phone", value: p.value, phoneType: p.type, isPrimary: firstNew && i === 0, personName: i === 0 ? d.decisor?.name ?? null : null, salutation: i === 0 ? d.decisor?.salutation ?? null : null, batchId });
    });
    if (d.email && !known.has(d.email)) contacts.push({ companyId: id, kind: "email", value: d.email, isPrimary: firstNew, personName: d.decisor?.name ?? null, salutation: d.decisor?.salutation ?? null, batchId });
    // 2.º decisor: com email fica no email; sem email fica como pessoa de contacto.
    const d2 = d.decisor2;
    if (d.email2 && !known.has(d.email2)) contacts.push({ companyId: id, kind: "email", value: d.email2, personName: d2?.name ?? null, salutation: d2?.salutation ?? null, batchId });
    else if (d2 && !d.email2 && !known.has(d2.name)) contacts.push({ companyId: id, kind: "person", value: d2.name, personName: d2.name, salutation: d2.salutation, batchId });
    for (const n of d.notes) if (!knownNotes.has(n.text)) notes.push({ companyId: id, kind: n.kind, text: n.text, userId, batchId });
  }
  for (let i = 0; i < contacts.length; i += 1000) await tx.insert(companyContacts).values(contacts.slice(i, i + 1000));
  for (let i = 0; i < notes.length; i += 1000) await tx.insert(companyNotes).values(notes.slice(i, i + 1000));
}

// ───────────── Anular um lote por inteiro ─────────────

export async function revertBatch(db: Db, userId: string, batchId: string) {
  const batch = await db.query.importBatches.findFirst({ where: eq(importBatches.id, batchId) });
  if (!batch) throw new AuthError(404, "Lote não encontrado.");
  if (batch.status !== "committed") throw new AuthError(409, "Só um lote gravado pode ser anulado.");
  await db.transaction(async (tx) => {
    await lockBatch(tx as unknown as Db, batchId, ["committed"], "Só um lote gravado pode ser anulado.");
    for (const r of await tx.select().from(importRows).where(and(eq(importRows.batchId, batchId), eq(importRows.result, "update")))) {
      if (r.before && r.companyId) await tx.update(companies).set({ ...(r.before as object), updatedAt: new Date() }).where(eq(companies.id, r.companyId));
    }
    await tx.delete(companyContacts).where(eq(companyContacts.batchId, batchId));
    await tx.delete(companyNotes).where(eq(companyNotes.batchId, batchId));
    await tx.delete(companies).where(eq(companies.batchId, batchId));
    await tx.update(importBatches).set({ status: "reverted", revertedAt: new Date() }).where(eq(importBatches.id, batchId));
    await tx.insert(auditLog).values({ userId, action: "importacao_anulada", entity: "import_batch", entityId: batchId, details: `Lote ${batch.number}` });
  });
  return { number: batch.number };
}

export async function discardBatch(db: Db, userId: string, batchId: string) {
  const batch = await db.query.importBatches.findFirst({ where: eq(importBatches.id, batchId) });
  if (!batch) throw new AuthError(404, "Lote não encontrado.");
  if (batch.status !== "uploaded" && batch.status !== "preview") throw new AuthError(409, "Este lote já foi gravado.");
  await db.delete(importRows).where(eq(importRows.batchId, batchId));
  await db.update(importBatches).set({ status: "discarded" }).where(eq(importBatches.id, batchId));
  await db.insert(auditLog).values({ userId, action: "importacao_cancelada", entity: "import_batch", entityId: batchId, details: `Lote ${batch.number}` });
}

export async function listBatches(db: Db) {
  return db.select({
    id: importBatches.id, number: importBatches.number, kind: importBatches.kind, fileName: importBatches.fileName, status: importBatches.status,
    summary: importBatches.summary, createdAt: importBatches.createdAt, committedAt: importBatches.committedAt, revertedAt: importBatches.revertedAt,
    createdBy: users.name,
  }).from(importBatches).leftJoin(users, eq(users.id, importBatches.createdBy)).orderBy(sql`${importBatches.number} desc`).limit(50);
}

export async function listBatchRows(db: Db, batchId: string, q: { result?: string; search?: string; offset?: number; limit?: number }) {
  const conds = [eq(importRows.batchId, batchId)];
  if (q.result) conds.push(eq(importRows.result, q.result));
  if (q.search) conds.push(sql`(${importRows.nif} ilike ${"%" + q.search + "%"} or ${importRows.name} ilike ${"%" + q.search + "%"})`);
  const where = and(...conds);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(importRows).where(where) as [{ n: number }];
  const rows = await db.select({
    id: importRows.id, sheet: importRows.sheet, rowNumber: importRows.rowNumber, nif: importRows.nif, name: importRows.name,
    result: importRows.result, detail: importRows.detail,
    accountType: sql<string | null>`${importRows.data}->>'accountType'`, owner: sql<string | null>`${importRows.data}->>'ownerLabel'`,
  }).from(importRows).where(where).orderBy(importRows.sheet, importRows.rowNumber).offset(q.offset ?? 0).limit(Math.min(q.limit ?? 100, 500));
  return { total: n, rows };
}
