import { pgTable, uuid, text, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
