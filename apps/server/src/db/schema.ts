import { pgTable, uuid, text, timestamp, pgEnum, boolean, integer, jsonb, numeric, date, serial, index, customType } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/** Perfis aprovados (Fase 02, matriz de permissões). */
export const roleEnum = pgEnum("role", ["admin", "team_lead", "sales"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: roleEnum("role").notNull(),
  active: boolean("active").notNull().default(true),
  /** Data de admissão: a fase de carreira muda sozinha a partir dela. */
  hiredAt: timestamp("hired_at", { withTimezone: true }),
  passwordHash: text("password_hash"),
  /** Segredo do Microsoft Authenticator, encriptado. Nulo até a 2FA estar ativa. */
  totpSecretEnc: text("totp_secret_enc"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  /** Palavra-passe provisória: tem de ser trocada na próxima entrada. */
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Passo intermédio do login: palavra-passe certa, falta o código 2FA. Dura 5 minutos. */
export const authChallenges = pgTable("auth_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id),
  /** Segredo proposto durante a ativação da 2FA (encriptado), antes de confirmado. */
  pendingTotpSecretEnc: text("pending_totp_secret_enc"),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/** Sessões abertas (uma por aparelho). O Administrador pode terminar a de um aparelho perdido. */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id),
  device: text("device"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** Registo de auditoria: quem fez o quê e quando. Nunca se apaga. */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  details: text("details"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

/** Configurações editáveis pelo Administrador (chave → valor). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

/* ───────────── Fase 2: Empresas ───────────── */

/** Cliente NOS ou prospeto (folhas NC e NN da base). */
export const accountTypeEnum = pgEnum("account_type", ["client", "prospect"]);
/** NC por omissão; FC só por alteração manual (conta 50 %). */
export const walletKindEnum = pgEnum("wallet_kind", ["NC", "FC"]);

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Número do lote, mostrado no ecrã («Lote 3»). */
  number: serial("number").notNull(),
  kind: text("kind").notNull(),
  fileName: text("file_name").notNull(),
  fileSha256: text("file_sha256").notNull(),
  /** O ficheiro original fica guardado com o lote, para consulta e auditoria. */
  fileData: bytea("file_data").notNull(),
  /** preview → committed → reverted (ou discarded, se nunca foi gravado). */
  status: text("status").notNull().default("preview"),
  options: jsonb("options").notNull(),
  summary: jsonb("summary").notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  committedAt: timestamp("committed_at", { withTimezone: true }),
  revertedAt: timestamp("reverted_at", { withTimezone: true }),
});

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  nif: text("nif").notNull().unique(),
  nifValid: boolean("nif_valid").notNull().default(true),
  name: text("name").notNull(),
  /** Nome limpo para comparar duplicados. */
  nameKey: text("name_key").notNull(),
  accountType: accountTypeEnum("account_type").notNull(),
  size: text("size"),
  employeesBand: text("employees_band"),
  /** Mensalidade contratada com a NOS (Valor L2B). */
  l2bMonthly: numeric("l2b_monthly", { precision: 12, scale: 2 }),
  loyaltyEnd: date("loyalty_end"),
  address: text("address"),
  postalCode: text("postal_code"),
  locality: text("locality"),
  municipality: text("municipality"),
  operator: text("operator"),
  economicGroup: text("economic_group"),
  /** Dono da carteira; nulo = sem carteira («Basecom»). */
  ownerId: uuid("owner_id").references(() => users.id),
  walletKind: walletKindEnum("wallet_kind").notNull().default("NC"),
  /** RGPD: nunca é reativada por uma importação. */
  doNotContact: boolean("do_not_contact").notNull().default(false),
  /** Duplicado provável (nome parecido + telefone ou código postal): lista de revisão. */
  needsReview: text("needs_review"),
  district: text("district"),
  sector: text("sector"),
  annualRevenue: numeric("annual_revenue", { precision: 14, scale: 2 }),
  locationsPotential: text("locations_potential"),
  /** Serviços NOS do cliente (folha «Lista Famílias»: VM, DM, IM, VF, DF, IF, TV, IT, Alarmes). */
  rgu: jsonb("rgu").$type<Record<string, number>>(),
  product: text("product"),
  technology: text("technology"),
  loyaltyMonths: integer("loyalty_months"),
  /** Dados do portal NOS: CLIENTE, EX-CLIENTE ou PROSPECT; mês de saída da NOS. */
  portalStatus: text("portal_status"),
  nosExitMonth: text("nos_exit_month"),
  /** Campanha NBO do portal, com a oferta («Campanha — Oferta»). */
  nboCampaign: text("nbo_campaign"),
  lastSourceYear: integer("last_source_year"),
  sources: text("sources"),
  batchId: uuid("batch_id").references(() => importBatches.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("companies_name_key_idx").on(t.nameKey), index("companies_owner_idx").on(t.ownerId), index("companies_postal_idx").on(t.postalCode), index("companies_district_idx").on(t.district), index("companies_sector_idx").on(t.sector)]);

/** Telefones e emails da empresa. Um número marcado «Incorreto» nunca é reativado por importação. */
export const companyContacts = pgTable("company_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  /** Telefone em 9 algarismos ou email em minúsculas. */
  value: text("value").notNull(),
  phoneType: text("phone_type"),
  personName: text("person_name"),
  salutation: text("salutation"),
  isPrimary: boolean("is_primary").notNull().default(false),
  status: text("status").notNull().default("valid"),
  batchId: uuid("batch_id").references(() => importBatches.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("company_contacts_value_idx").on(t.value), index("company_contacts_company_idx").on(t.companyId)]);

/** Histórico da empresa: notas importadas, campanhas antigas e, mais tarde, resultados de chamadas. */
export const companyNotes = pgTable("company_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  userId: uuid("user_id").references(() => users.id),
  batchId: uuid("batch_id").references(() => importBatches.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("company_notes_company_idx").on(t.companyId)]);

/** Zona de preparação: cada linha do ficheiro com o resultado previsto, antes de gravar. */
export const importRows = pgTable("import_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
  sheet: text("sheet").notNull(),
  rowNumber: integer("row_number").notNull(),
  nif: text("nif"),
  name: text("name"),
  /** new | update | duplicate_review | nif_to_verify | blocked | review | rejected */
  result: text("result").notNull(),
  detail: text("detail"),
  data: jsonb("data").notNull(),
  /** Valores anteriores numa atualização, para anular o lote. */
  before: jsonb("before"),
  companyId: uuid("company_id"),
}, (t) => [index("import_rows_batch_idx").on(t.batchId)]);
