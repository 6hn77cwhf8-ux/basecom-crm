import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadConfig } from "../config.js";
import { createDb } from "./client.js";

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
await pool.end();
console.log("Migrações aplicadas.");
