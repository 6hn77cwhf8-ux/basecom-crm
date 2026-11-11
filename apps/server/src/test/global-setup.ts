import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../db/client.js";

/** Prepara a base de dados de testes uma única vez, antes de todos os ficheiros (evita corridas). */
export default async function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const { db, pool } = createDb(url);
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  await pool.end();
}
