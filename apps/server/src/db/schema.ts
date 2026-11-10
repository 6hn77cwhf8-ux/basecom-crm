import { pgTable, uuid, text, timestamp, pgEnum, boolean, integer, jsonb } from "drizzle-orm/pg-core";

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
